"use server";

import { FieldValue } from "firebase-admin/firestore";
import { revalidateTag, unstable_cache } from "next/cache";

import { getAdmin } from "@/lib/firebaseAdmin";
import { randomToken } from "@/lib/accessTokens";
import type { PackageFolder } from "@/types";
import { collectFolderServiceIds } from "@/lib/folderServices";
import { buildServiceAssignmentFields } from "@/lib/serviceAssignment";

const getDb = () => getAdmin().db;
const foldersCollection = () => getDb().collection("packageFolders");
const accessTokensCollection = () => getDb().collection("accessTokens");
const packagesCollection = () => getDb().collection("packages");
const servicesCollection = () => getDb().collection("services");

const FOLDER_CACHE_TTL_SECONDS = 300;

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  const ts = value as { toMillis?: () => number } | null | undefined;
  if (ts && typeof ts.toMillis === "function") {
    const millis = ts.toMillis();
    if (typeof millis === "number" && Number.isFinite(millis)) {
      return millis;
    }
  }
  return undefined;
}

function mapFolderDoc(doc: FirebaseFirestore.DocumentSnapshot): PackageFolder {
  const data = (doc.data() ?? {}) as Record<string, unknown>;
  const services = collectFolderServiceIds({
    services: data.services,
    serviceIds: (data as Record<string, unknown>).serviceIds,
    servicos: (data as Record<string, unknown>).servicos,
  });

  return {
    id: doc.id,
    packageId: typeof data.packageId === "string" ? data.packageId : "",
    name: typeof data.name === "string" ? data.name : "",
    companyId:
      typeof data.companyId === "string" && data.companyId.trim() ? data.companyId.trim() : null,
    services,
    tokenId:
      typeof data.tokenId === "string" && data.tokenId.trim() ? data.tokenId.trim() :
      typeof data.tokenCode === "string" && data.tokenCode.trim() ? data.tokenCode.trim() :
      null,
    tokenCode:
      typeof data.tokenCode === "string" && data.tokenCode.trim() ? data.tokenCode.trim() :
      typeof data.tokenId === "string" && data.tokenId.trim() ? data.tokenId.trim() :
      null,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    tokenCreatedAt: toMillis(data.tokenCreatedAt),
  };
}

function normaliseId(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

async function createFolderToken(
  folderId: string,
  options: { packageId?: string; companyId?: string | null },
): Promise<{ code: string }> {
  const col = accessTokensCollection();
  const packageId = normaliseId(options.packageId ?? undefined);
  const companyId = normaliseId(options.companyId ?? undefined);

  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomToken(8 + Math.min(attempt, 2));
    const payload: Record<string, unknown> = {
      code,
      token: code,
      targetType: "folder",
      targetId: folderId,
      folderId,
      pastaId: folderId,
      active: true,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
    };

    if (packageId) {
      payload.packageId = packageId;
      payload.pacoteId = packageId;
    }

    if (companyId) {
      payload.company = companyId;
      payload.companyId = companyId;
      payload.empresa = companyId;
      payload.empresaId = companyId;
    }

    try {
      await col.doc(code).create(payload);
      return { code };
    } catch (err) {
      const error = err as { code?: unknown; details?: unknown; message?: unknown };
      const codeStr = typeof error.code === "string" ? error.code : String(error.code ?? "");
      const details = typeof error.details === "string" ? error.details : "";
      const message = typeof error.message === "string" ? error.message : "";
      const alreadyExists =
        codeStr === "6" ||
        codeStr === "ALREADY_EXISTS" ||
        codeStr === "already-exists" ||
        details === "ALREADY_EXISTS" ||
        /already exists/i.test(message);
      if (alreadyExists) {
        continue;
      }
      throw err;
    }
  }

  throw new Error("Não foi possível gerar token único para a pasta.");
}

async function deactivateToken(tokenId: string | null | undefined) {
  if (!tokenId) return;
  const ref = accessTokensCollection().doc(tokenId);
  const snap = await ref.get();
  if (!snap.exists) return;
  await ref.update({ active: false, status: "revoked", revoked: true, updatedAt: FieldValue.serverTimestamp() });
}

const packageFolderCollator = new Intl.Collator("pt-BR", { sensitivity: "base" });

const listPackageFoldersCache = unstable_cache(
  async (packageId: string) => fetchPackageFolders(packageId),
  ["folders", "by-package"],
  {
    revalidate: FOLDER_CACHE_TTL_SECONDS,
    tags: ["folders:by-package"],
  },
);

const getPackageFolderCache = unstable_cache(
  async (folderId: string) => fetchPackageFolder(folderId),
  ["folders", "detail"],
  {
    revalidate: FOLDER_CACHE_TTL_SECONDS,
    tags: ["folders:detail"],
  },
);

async function fetchPackageFolders(packageId: string): Promise<PackageFolder[]> {
  if (!packageId) return [];
  const snap = await foldersCollection().where("packageId", "==", packageId).get();
  return snap.docs
    .map((doc) => mapFolderDoc(doc))
    .sort((a, b) => packageFolderCollator.compare(a.name, b.name));
}

async function fetchPackageFolder(folderId: string): Promise<PackageFolder | null> {
  if (!folderId) return null;
  const snap = await foldersCollection().doc(folderId).get();
  if (!snap.exists) return null;
  return mapFolderDoc(snap);
}

function revalidateFolderCaches() {
  revalidateTag("folders:by-package");
  revalidateTag("folders:detail");
}

export async function listPackageFolders(packageId: string): Promise<PackageFolder[]> {
  const trimmedId = typeof packageId === "string" ? packageId.trim() : "";
  if (!trimmedId) return [];
  return listPackageFoldersCache(trimmedId);
}

export async function getPackageFolder(folderId: string): Promise<PackageFolder | null> {
  const trimmedId = typeof folderId === "string" ? folderId.trim() : "";
  if (!trimmedId) return null;
  return getPackageFolderCache(trimmedId);
}

export async function createPackageFolder({
  packageId,
  name,
  companyId,
}: {
  packageId: string;
  name: string;
  companyId?: string | null;
}): Promise<PackageFolder> {
  const trimmedName = name.trim();
  if (!trimmedName) {
    throw new Error("Nome da pasta é obrigatório.");
  }
  if (!packageId) {
    throw new Error("Pacote inválido.");
  }

  const folderRef = foldersCollection().doc();
  const now = FieldValue.serverTimestamp();

  await folderRef.set({
    packageId,
    name: trimmedName,
    companyId: companyId?.trim() || null,
    services: [],
    serviceIds: [],
    servicos: [],
    createdAt: now,
    updatedAt: now,
  });

  const token = await createFolderToken(folderRef.id, { packageId, companyId });
  await folderRef.update({
    tokenId: token.code,
    tokenCode: token.code,
    tokenCreatedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  const snap = await folderRef.get();
  const folder = mapFolderDoc(snap);
  revalidateFolderCaches();
  return folder;
}

export async function updatePackageFolder(
  folderId: string,
  data: { name?: string; companyId?: string | null },
): Promise<PackageFolder> {
  if (!folderId) {
    throw new Error("Pasta inválida.");
  }
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
  if (typeof data.name === "string") {
    const trimmed = data.name.trim();
    if (!trimmed) {
      throw new Error("Nome da pasta não pode ficar vazio.");
    }
    updates.name = trimmed;
  }
  if (data.companyId !== undefined) {
    const trimmed = typeof data.companyId === "string" ? data.companyId.trim() : "";
    updates.companyId = trimmed || null;
  }

  await foldersCollection().doc(folderId).set(updates, { merge: true });
  const snap = await foldersCollection().doc(folderId).get();
  if (!snap.exists) {
    throw new Error("Pasta não encontrada após atualização.");
  }
  const folder = mapFolderDoc(snap);
  revalidateFolderCaches();
  return folder;
}

export async function setFolderServices(folderId: string, serviceIds: string[]): Promise<PackageFolder> {
  if (!folderId) {
    throw new Error("Pasta inválida.");
  }
  const unique = Array.from(new Set(serviceIds.map((value) => value.trim()).filter((value) => value.length > 0)));
  const folderRef = foldersCollection().doc(folderId);
  const folderSnap = await folderRef.get();
  if (!folderSnap.exists) {
    throw new Error("Pasta não encontrada.");
  }
  const originalFolder = mapFolderDoc(folderSnap);
  const targetPackageId = originalFolder.packageId?.trim() || null;

  if (targetPackageId && unique.length > 0) {
    const serviceSnaps = await Promise.all(unique.map((serviceId) => servicesCollection().doc(serviceId).get()));
    for (const snap of serviceSnaps) {
      if (!snap.exists) continue;
      const data = (snap.data() ?? {}) as Record<string, unknown>;
      const servicePackageId =
        (typeof data.packageId === "string" && data.packageId.trim()) ||
        (typeof data.pacoteId === "string" && data.pacoteId.trim()) ||
        null;
      if (servicePackageId && servicePackageId !== targetPackageId) {
        throw new Error("Não é permitido vincular um serviço que já pertence a outro pacote.");
      }
    }
  }

  await folderRef.update({
    services: unique,
    serviceIds: unique,
    servicos: unique,
    updatedAt: FieldValue.serverTimestamp(),
  });

  const updatedSnap = await folderRef.get();
  if (!updatedSnap.exists) {
    throw new Error("Pasta não encontrada após atualizar serviços.");
  }

  const updatedFolder = mapFolderDoc(updatedSnap);
  const packageId = updatedFolder.packageId || originalFolder.packageId;

  if (packageId) {
    const packageRef = packagesCollection().doc(packageId);
    const packageSnap = await packageRef.get();
    const packageData = (packageSnap.data() ?? {}) as Record<string, unknown>;
    const previousServices = new Set<string>();

    const collectServices = (input: unknown) => {
      if (!Array.isArray(input)) return;
      input.forEach((value) => {
        if (typeof value !== "string") return;
        const trimmed = value.trim();
        if (trimmed) {
          previousServices.add(trimmed);
        }
      });
    };

    collectServices(packageData.services);
    collectServices(packageData.serviceIds);

    const siblingsSnap = await foldersCollection().where("packageId", "==", packageId).get();
    const aggregatedSet = new Set<string>();
    siblingsSnap.docs.forEach((doc) => {
      const folder = mapFolderDoc(doc);
      folder.services.forEach((serviceId) => {
        const trimmed = serviceId.trim();
        if (trimmed) {
          aggregatedSet.add(trimmed);
        }
      });
    });

    const aggregatedServices = Array.from(aggregatedSet);

    await packageRef.set(
      {
        services: aggregatedServices,
        serviceIds: aggregatedServices,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

    const removed = Array.from(previousServices).filter((id) => !aggregatedSet.has(id));

    const serviceUpdates: Promise<unknown>[] = [];

    // A pasta é canônica mesmo quando o serviço já constava no array legado do
    // pacote; portanto sincronize todos os IDs da pasta alvo, não apenas os que
    // são novos no agregado do pacote.
    unique.forEach((serviceId) => {
      const ref = servicesCollection().doc(serviceId);
      serviceUpdates.push(
        ref.set(
          {
            ...buildServiceAssignmentFields({ packageId, folderId }),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      );
    });

    removed.forEach((serviceId) => {
      const ref = servicesCollection().doc(serviceId);
      serviceUpdates.push(
        ref.set(
          {
            ...buildServiceAssignmentFields({ packageId: null, folderId: null }),
            updatedAt: FieldValue.serverTimestamp(),
          },
          { merge: true },
        ),
      );
    });

    if (serviceUpdates.length) {
      await Promise.all(serviceUpdates);
    }
  }

  revalidateFolderCaches();
  revalidateTag("packages:detail");
  revalidateTag("packages:summary");
  revalidateTag("packages:services");
  revalidateTag("services:recent");
  revalidateTag("services:detail");
  revalidateTag("services:available");

  return updatedFolder;
}

export async function rotateFolderToken(folderId: string): Promise<PackageFolder> {
  if (!folderId) {
    throw new Error("Pasta inválida.");
  }

  const snap = await foldersCollection().doc(folderId).get();
  if (!snap.exists) {
    throw new Error("Pasta não encontrada.");
  }

  const folder = mapFolderDoc(snap);
  const token = await createFolderToken(folderId, {
    packageId: folder.packageId,
    companyId: folder.companyId ?? undefined,
  });

  await deactivateToken(folder.tokenId ?? folder.tokenCode ?? undefined);

  await foldersCollection()
    .doc(folderId)
    .update({
      tokenId: token.code,
      tokenCode: token.code,
      tokenCreatedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

  const updated = await foldersCollection().doc(folderId).get();
  if (!updated.exists) {
    throw new Error("Pasta não encontrada após rotação de token.");
  }
  const updatedFolder = mapFolderDoc(updated);
  revalidateFolderCaches();
  return updatedFolder;
}

export async function deletePackageFolder(folderId: string): Promise<{ deletedId: string; unlinkedServices: number }> {
  if (!folderId) {
    throw new Error("Pasta inválida.");
  }

  const folderRef = foldersCollection().doc(folderId);
  const folderSnap = await folderRef.get();
  if (!folderSnap.exists) {
    throw new Error("Pasta não encontrada.");
  }

  const folder = mapFolderDoc(folderSnap);
  const uniqueServiceIds = Array.from(new Set(folder.services.map((value) => value.trim()).filter(Boolean)));

  if (uniqueServiceIds.length) {
    await Promise.all(
      uniqueServiceIds.map((serviceId) =>
        servicesCollection()
          .doc(serviceId)
          .set(
            {
              ...buildServiceAssignmentFields({ packageId: folder.packageId || null, folderId: null }),
              subpackageId: FieldValue.delete(),
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          ),
      ),
    );
  }

  await deactivateToken(folder.tokenId ?? folder.tokenCode ?? undefined);
  await folderRef.delete();

  revalidateFolderCaches();
  revalidateTag("packages:detail");
  revalidateTag("packages:summary");
  revalidateTag("packages:services");
  revalidateTag("services:detail");
  revalidateTag("services:available");

  return { deletedId: folderId, unlinkedServices: uniqueServiceIds.length };
}
