"use server";

import { getAdmin } from "@/lib/firebaseAdmin";
import type { Package, Service } from "@/lib/types";
import { FieldValue } from "firebase-admin/firestore";
import { revalidateTag, unstable_cache } from "next/cache";
import {
  MAX_ATOMIC_PACKAGE_SERVICES,
  chunkForSafeWrites,
} from "@/lib/firestoreWriteLimits";
import { buildServiceAssignmentFields } from "@/lib/serviceAssignment";
import { resolveServiceAssignment } from "@/lib/serviceAssignment";

const FIREBASE_ADMIN_NOT_CONFIGURED = "FIREBASE_ADMIN_NOT_CONFIGURED";

const missingAdminWarnings = new Set<string>();

function isMissingAdminError(error: unknown): boolean {
  if (error instanceof Error) {
    if (error.message === FIREBASE_ADMIN_NOT_CONFIGURED) {
      return true;
    }
    const cause = (error as { cause?: unknown }).cause;
    if (cause) {
      return isMissingAdminError(cause);
    }
  }
  return false;
}

function logMissingAdmin(scope: string, error?: unknown) {
  if (missingAdminWarnings.has(scope)) return;
  const message = `[packages:${scope}] Firebase Admin não está configurado.`;
  if (process.env.NODE_ENV !== "production") {
    if (error) {
      console.warn(message, error);
    } else {
      console.warn(message);
    }
  } else {
    console.warn(message);
  }
  missingAdminWarnings.add(scope);
}

const getDb = () => getAdmin().db;
const packagesCollection = () => getDb().collection("packages");
const servicesCollection = () => getDb().collection("services");
const foldersCollection = () => getDb().collection("packageFolders");
const accessTokensCollection = () => getDb().collection("accessTokens");

function packagesCollectionOptional(): FirebaseFirestore.CollectionReference | null {
  try {
    return packagesCollection();
  } catch (error) {
    if (isMissingAdminError(error)) {
      return null;
    }
    console.warn("[packages] Falha ao acessar a coleção de pacotes.", error);
    return null;
  }
}

function servicesCollectionOptional(): FirebaseFirestore.CollectionReference | null {
  try {
    return servicesCollection();
  } catch (error) {
    if (isMissingAdminError(error)) {
      return null;
    }
    console.warn("[packages] Falha ao acessar a coleção de serviços.", error);
    return null;
  }
}

const PACKAGE_CACHE_TTL_SECONDS = 300;
const DEFAULT_PACKAGE_SERVICES_LIMIT = 100;

function normalisePackageServiceLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
    return DEFAULT_PACKAGE_SERVICES_LIMIT;
  }
  const safeLimit = Math.floor(limit);
  return Math.max(1, Math.min(safeLimit, 2000));
}

const PACKAGE_DETAIL_BASE_FIELDS = [
  "name",
  "nome",
  "status",
  "plannedStart",
  "dataInicio",
  "inicioPlanejado",
  "startDate",
  "plannedEnd",
  "dataFim",
  "fimPlanejado",
  "endDate",
  "totalHours",
  "horasTotais",
  "totalHoras",
  "code",
  "codigo",
  "description",
  "descricao",
  "details",
  "createdAt",
  "created_at",
  "criadoEm",
  "createdAtMs",
  "assignedCompanies",
  "serviceIds",
];

const packageSummaryCache = (() => {
  const cacheById = new Map<string, () => Promise<Package | null>>();
  return async (packageId: string) => {
    const cacheKey = packageId || "__empty__";
    let cachedFetcher = cacheById.get(cacheKey);
    if (!cachedFetcher) {
      cachedFetcher = unstable_cache(
        async () => {
          const collection = packagesCollectionOptional();
          if (!collection) {
            logMissingAdmin("summary:collection");
            return null;
          }
          try {
            const snap = await collection
              .doc(packageId)
              .get({ fieldMask: ["name", "nome", "status", "serviceIds", "createdAt"] });
            if (!snap.exists) return null;
            return mapPackageDoc(snap);
          } catch (error) {
            if (isMissingAdminError(error)) {
              logMissingAdmin("summary:fetch", error);
              return null;
            }
            console.warn(
              `[packages:summary:fetch] Falha ao carregar pacote ${packageId}. Retornando dados vazios.`,
              error,
            );
            return null;
          }
        },
        ["packages", "summary", cacheKey],
        {
          revalidate: PACKAGE_CACHE_TTL_SECONDS,
          tags: ["packages:summary"],
        },
      );
      cacheById.set(cacheKey, cachedFetcher);
    }
    return cachedFetcher();
  };
})();

const packageDetailCache = (() => {
  const cacheById = new Map<string, () => Promise<Package | null>>();
  return async (packageId: string) => {
    const cacheKey = packageId || "__empty__";
    let cachedFetcher = cacheById.get(cacheKey);
    if (!cachedFetcher) {
      cachedFetcher = unstable_cache(
        () => fetchPackageDetail(packageId),
        ["packages", "detail", cacheKey],
        {
          revalidate: PACKAGE_CACHE_TTL_SECONDS,
          tags: ["packages:detail"],
        },
      );
      cacheById.set(cacheKey, cachedFetcher);
    }
    return cachedFetcher();
  };
})();

const listPackageServicesCache = unstable_cache(
  async (packageId: string, limit: number) => fetchPackageServices(packageId, limit),
  ["packages", "services", "by-package"],
  {
    revalidate: PACKAGE_CACHE_TTL_SECONDS,
    tags: ["packages:services"],
  },
);

const recentPackagesCache = unstable_cache(
  async () => fetchRecentPackages(),
  ["packages", "recent"],
  {
    revalidate: PACKAGE_CACHE_TTL_SECONDS,
    tags: ["packages:recent"],
  },
);

async function fetchPackageDetail(packageId: string): Promise<Package | null> {
  const collection = packagesCollectionOptional();
  if (!collection) {
    logMissingAdmin("detail:collection");
    return null;
  }

  const docRef = collection.doc(packageId);
  let snap: FirebaseFirestore.DocumentSnapshot;

  try {
    snap = await docRef.get({ fieldMask: PACKAGE_DETAIL_BASE_FIELDS });
  } catch (error) {
    if (isMissingAdminError(error)) {
      logMissingAdmin("detail:fetch", error);
      return null;
    }
    console.warn(
      `[packages:fetchPackageDetail] Failed to fetch projected fields for package ${packageId}`,
      error,
    );
    try {
      snap = await docRef.get();
    } catch (fallbackError) {
      if (isMissingAdminError(fallbackError)) {
        logMissingAdmin("detail:fallback", fallbackError);
        return null;
      }
      console.warn(
        `[packages:fetchPackageDetail] Falha ao carregar pacote ${packageId} com fallback completo. Retornando dados vazios.`,
        fallbackError,
      );
      return null;
    }
  }
  if (!snap.exists) return null;

  const baseData = (snap.data() ?? {}) as Record<string, unknown>;

  if (!Array.isArray(baseData.serviceIds) || baseData.serviceIds.length === 0) {
    try {
      const servicesSnap = await docRef.get({ fieldMask: ["services"] });
      if (servicesSnap.exists) {
        const servicesData = servicesSnap.data() ?? {};
        if (Array.isArray((servicesData as Record<string, unknown>).services)) {
          baseData.services = (servicesData as Record<string, unknown>).services;
        }
      }
    } catch (error) {
      console.warn(`[packages:getPackageById] Failed to fetch legacy services for package ${packageId}`, error);
    }
  }

  return mapPackageData(snap.id, baseData);
}

function revalidatePackageDetailCache(packageId: string) {
  if (!packageId) return;
  revalidateTag("packages:detail");
  revalidateTag("packages:summary");
  revalidateTag("packages:services");
  revalidateTag("services:available");
}

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  const maybeTimestamp = value as { toMillis?: () => number } | undefined;
  if (maybeTimestamp?.toMillis) return maybeTimestamp.toMillis();
  return undefined;
}

function mapPackageDoc(
  doc: FirebaseFirestore.DocumentSnapshot,
): Package {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    name: data.name ?? "",
    status: data.status ?? "aberto",
    serviceIds: data.serviceIds ?? [],
    createdAt: toMillis(data.createdAt),
  };
}

export async function getPackage(packageId: string): Promise<Package | null> {
  const trimmedId = typeof packageId === "string" ? packageId.trim() : "";
  if (!trimmedId) return null;

  return packageSummaryCache(trimmedId);
}

function normaliseDateOnlyInput(value: string | null | undefined, label: string): string {
  if (value === undefined) {
    throw new Error(`Informe a data ${label} do pacote.`);
  }
  if (value === null) {
    return "";
  }
  const trimmed = String(value).trim();
  if (!trimmed) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Data ${label} inválida.`);
  }
  return date.toISOString().slice(0, 10);
}

async function commitBatchOperations(
  operations: Array<(batch: FirebaseFirestore.WriteBatch) => void>,
  chunkSize = 400,
): Promise<void> {
  if (!operations.length) {
    return;
  }
  const db = getDb();
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = db.batch();
    operations.slice(index, index + chunkSize).forEach((operation) => {
      operation(batch);
    });
    await batch.commit();
  }
}

function normalisePackageStatus(value: unknown): Package["status"] {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "concluido" || raw === "concluído") return "Concluído";
  if (raw === "encerrado") return "Encerrado";
  return "Aberto";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "object" && value && "toMillis" in value) {
    const possible = (value as { toMillis?: () => number }).toMillis?.();
    if (typeof possible === "number" && Number.isFinite(possible)) return possible;
  }
  return undefined;
}

function extractServiceId(value: unknown): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const candidates: unknown[] = [
      record.id,
      record.serviceId,
      record.serviceID,
      record.service,
      record.code,
      record.codigo,
      record.os,
      record.OS,
    ];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return candidate.trim();
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return String(candidate);
      }
    }
  }
  return "";
}

function normaliseServiceIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item) => extractServiceId(item))
    .filter((id) => id.length > 0);
  return entries.length ? entries : undefined;
}

function mapPackageData(id: string, data: Record<string, unknown>): Package {
  const plannedStart = String(
    data.plannedStart ?? data.dataInicio ?? data.inicioPlanejado ?? data.startDate ?? "",
  );
  const plannedEnd = String(
    data.plannedEnd ?? data.dataFim ?? data.fimPlanejado ?? data.endDate ?? "",
  );
  const totalHours = toNumber(data.totalHours ?? data.horasTotais ?? data.totalHoras) ?? 0;
  const createdAt =
    toNumber(data.createdAt ?? data.created_at ?? data.criadoEm ?? data.createdAtMs) ?? Date.now();

  const descriptionRaw =
    typeof data.description === "string"
      ? data.description
      : typeof data.descricao === "string"
        ? data.descricao
        : typeof data.details === "string"
          ? data.details
          : undefined;
  const description = typeof descriptionRaw === "string" ? descriptionRaw.trim() : "";

  const assignedCompanies = Array.isArray(data.assignedCompanies)
    ? (data.assignedCompanies as Record<string, unknown>[]).map((entry) => ({
        companyId: String(entry.companyId ?? entry.id ?? ""),
        companyName: entry.companyName ? String(entry.companyName) : undefined,
      }))
    : undefined;

  const normalisedServiceIds = normaliseServiceIds(data.serviceIds);
  const normalisedLegacyServices = normaliseServiceIds(data.services);
  const serviceIds = normalisedServiceIds ?? normalisedLegacyServices;
  const services = serviceIds ?? normalisedLegacyServices;

  return {
    id,
    name: String(data.name ?? data.nome ?? `Pacote ${id}`),
    status: normalisePackageStatus(data.status),
    plannedStart,
    plannedEnd,
    totalHours,
    code: data.code ? String(data.code) : data.codigo ? String(data.codigo) : undefined,
    description: description ? description : null,
    services,
    createdAt,
    assignedCompanies,
    serviceIds,
  };
}

export type PackageSummary = Pick<Package, "id" | "name" | "status" | "code" | "createdAt"> & {
  servicesCount: number;
};

function toPackageSummary(id: string, data: Record<string, unknown>): PackageSummary {
  const services = Array.isArray(data.services)
    ? (data.services as unknown[])
    : Array.isArray(data.serviceIds)
      ? (data.serviceIds as unknown[])
      : [];
  const servicesCount = services.length;
  const createdAt =
    toNumber(data.createdAt ?? data.created_at ?? data.criadoEm ?? data.createdAtMs) ?? Date.now();

  return {
    id,
    name: String(data.name ?? data.nome ?? `Pacote ${id}`),
    status: normalisePackageStatus(data.status),
    code: data.code ? String(data.code) : data.codigo ? String(data.codigo) : undefined,
    createdAt,
    servicesCount,
  };
}

export async function getPackageByIdCached(id: string): Promise<Package | null> {
  const trimmedId = typeof id === "string" ? id.trim() : "";
  if (!trimmedId) return null;
  return packageDetailCache(trimmedId);
}

export async function getPackageById(id: string): Promise<Package | null> {
  const trimmedId = typeof id === "string" ? id.trim() : "";
  if (!trimmedId) return null;

  let cached: Package | null = null;
  try {
    cached = await getPackageByIdCached(trimmedId);
  } catch (error) {
    console.warn(`[packages:getPackageById] Failed to read cached package ${trimmedId}`, error);
  }
  if (cached) return cached;

  try {
    const fresh = await fetchPackageDetail(trimmedId);
    if (fresh) {
      return fresh;
    }
  } catch (error) {
    console.warn(`[packages:getPackageById] Failed to fetch fresh package ${trimmedId}`, error);
  }

  return null;
}

async function fetchRecentPackages(): Promise<PackageSummary[]> {
  const collection = packagesCollectionOptional();
  if (!collection) {
    logMissingAdmin("recent:collection");
    return [];
  }
  try {
    const snap = await collection.orderBy("createdAt", "desc").limit(20).get();
    return snap.docs.map((doc) => toPackageSummary(doc.id, (doc.data() ?? {}) as Record<string, unknown>));
  } catch (error) {
    if (isMissingAdminError(error)) {
      logMissingAdmin("recent:fetch", error);
      return [];
    }
    console.warn("[packages:listRecent] Falha ao carregar pacotes recentes. Retornando lista vazia.", error);
    return [];
  }
}

export async function listRecentPackages(): Promise<PackageSummary[]> {
  return recentPackagesCache();
}

async function fetchPackageServices(packageId: string, limit: number): Promise<Service[]> {
  if (!packageId) return [];
  const collection = servicesCollectionOptional();
  if (!collection) {
    logMissingAdmin("services:list");
    return [];
  }

  const safeLimit = normalisePackageServiceLimit(limit);
  let query: FirebaseFirestore.Query = collection.where("packageId", "==", packageId);

  if (safeLimit > 0) {
    query = query.orderBy("createdAt", "desc").limit(safeLimit);
  }

  try {
    const servicesSnap = await query.get();
    return servicesSnap.docs.map((doc) => {
      const data = doc.data() ?? {};
      return {
        id: doc.id,
        os: data.os ?? "",
        oc: data.oc ?? undefined,
        tag: data.tag ?? "",
        equipmentName: data.equipmentName ?? "",
        sector: data.sector ?? "",
        plannedStart: data.plannedStart ?? "",
        plannedEnd: data.plannedEnd ?? "",
        totalHours: data.totalHours ?? 0,
        status: data.status ?? "aberto",
        company: data.company ?? undefined,
        createdAt: toMillis(data.createdAt),
        updatedAt: toMillis(data.updatedAt),
        hasChecklist: data.hasChecklist ?? false,
        realPercent: data.realPercent ?? 0,
        packageId: data.packageId ?? undefined,
      };
    });
  } catch (error) {
    if (isMissingAdminError(error)) {
      logMissingAdmin("services:fetch", error);
      return [];
    }
    console.warn(
      `[packages:listPackageServices] Falha ao listar serviços do pacote ${packageId}. Retornando lista vazia.`,
      error,
    );
    return [];
  }
}

export async function listPackageServices(
  packageId: string,
  options?: { limit?: number },
): Promise<Service[]> {
  const trimmedId = typeof packageId === "string" ? packageId.trim() : "";
  if (!trimmedId) return [];
  const safeLimit = normalisePackageServiceLimit(options?.limit);
  return listPackageServicesCache(trimmedId, safeLimit);
}

export async function createPackage(
  name: string,
  serviceIds: string[],
): Promise<string> {
  const uniqueServiceIds = Array.from(new Set(serviceIds));

  const { db } = getAdmin();
  if (uniqueServiceIds.length <= MAX_ATOMIC_PACKAGE_SERVICES) {
    const packageId = await db.runTransaction(async (tx) => {
      const packageRef = packagesCollection().doc();
      tx.set(packageRef, {
        name,
        status: "aberto",
        serviceIds: uniqueServiceIds,
        createdAt: FieldValue.serverTimestamp(),
      });

      uniqueServiceIds.forEach((serviceId) => {
        tx.update(servicesCollection().doc(serviceId), {
          ...buildServiceAssignmentFields({ packageId: packageRef.id, folderId: null }),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      return packageRef.id;
    });
    revalidateTag("packages:recent");
    revalidateTag("services:recent");
    revalidateTag("packages:services");
    revalidatePackageDetailCache(packageId);
    return packageId;
  }

  const packageRef = packagesCollection().doc();
  const serviceRefs = uniqueServiceIds.map((serviceId) => servicesCollection().doc(serviceId));
  const snapshots = await db.getAll(...serviceRefs);
  const missing = snapshots.filter((snapshot) => !snapshot.exists).map((snapshot) => snapshot.id);
  if (missing.length) {
    throw new Error(`Serviço(s) não encontrado(s): ${missing.slice(0, 5).join(", ")}`);
  }

  await packageRef.create({
    name,
    status: "aberto",
    serviceIds: uniqueServiceIds,
    createdAt: FieldValue.serverTimestamp(),
    assignmentSyncPending: true,
  });

  const updatedSnapshots: FirebaseFirestore.DocumentSnapshot[] = [];
  try {
    for (const chunk of chunkForSafeWrites(snapshots)) {
      const batch = db.batch();
      chunk.forEach((snapshot) => {
        batch.update(snapshot.ref, {
          ...buildServiceAssignmentFields({ packageId: packageRef.id, folderId: null }),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await batch.commit();
      updatedSnapshots.push(...chunk);
    }
    await packageRef.update({ assignmentSyncPending: FieldValue.delete() });
  } catch (error) {
    for (const chunk of chunkForSafeWrites(updatedSnapshots)) {
      const rollback = db.batch();
      chunk.forEach((snapshot) => {
        const data = snapshot.data() ?? {};
        const originalAssignment = resolveServiceAssignment(data);
        rollback.update(snapshot.ref, {
          ...buildServiceAssignmentFields(originalAssignment),
          updatedAt: FieldValue.serverTimestamp(),
        });
      });
      await rollback.commit();
    }
    await packageRef.delete();
    throw error;
  }

  const packageId = packageRef.id;

  revalidateTag("packages:recent");
  revalidateTag("services:recent");
  revalidateTag("packages:services");
  revalidatePackageDetailCache(packageId);

  return packageId;
}

export async function updatePackageMetadata(
  packageId: string,
  data: {
    name?: string;
    description?: string | null;
    plannedStart?: string;
    plannedEnd?: string;
    status?: Package["status"];
    code?: string | null;
  },
): Promise<Package> {
  const trimmedId = typeof packageId === "string" ? packageId.trim() : "";
  if (!trimmedId) {
    throw new Error("Pacote inválido.");
  }

  const ref = packagesCollection().doc(trimmedId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Pacote não encontrado.");
  }

  const existing = mapPackageData(trimmedId, (snap.data() ?? {}) as Record<string, unknown>);
  const updates: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };

  if (data.name !== undefined) {
    const trimmedName = typeof data.name === "string" ? data.name.trim() : "";
    if (!trimmedName) {
      throw new Error("Informe o nome do pacote.");
    }
    updates.name = trimmedName;
    updates.nome = trimmedName;
  }

  let nextStart = existing.plannedStart?.trim() ?? "";
  if (data.plannedStart !== undefined) {
    if (typeof data.plannedStart !== "string") {
      throw new Error("Data inicial inválida.");
    }
    const normalised = normaliseDateOnlyInput(data.plannedStart, "inicial");
    if (!normalised) {
      throw new Error("Informe a data inicial do pacote.");
    }
    nextStart = normalised;
    updates.plannedStart = normalised;
    updates.dataInicio = normalised;
    updates.inicioPlanejado = normalised;
    updates.startDate = normalised;
  }

  let nextEnd = existing.plannedEnd?.trim() ?? "";
  if (data.plannedEnd !== undefined) {
    if (typeof data.plannedEnd !== "string") {
      throw new Error("Data final inválida.");
    }
    const normalised = normaliseDateOnlyInput(data.plannedEnd, "final");
    if (!normalised) {
      throw new Error("Informe a data final do pacote.");
    }
    nextEnd = normalised;
    updates.plannedEnd = normalised;
    updates.dataFim = normalised;
    updates.fimPlanejado = normalised;
    updates.endDate = normalised;
  }

  if (nextStart && nextEnd) {
    const startDate = new Date(nextStart);
    const endDate = new Date(nextEnd);
    if (
      !Number.isNaN(startDate.getTime()) &&
      !Number.isNaN(endDate.getTime()) &&
      startDate.getTime() > endDate.getTime()
    ) {
      throw new Error("A data final deve ser posterior ou igual à data inicial.");
    }
  }

  if (data.description !== undefined) {
    const trimmedDescription =
      typeof data.description === "string" ? data.description.trim() : "";
    const value = trimmedDescription ? trimmedDescription : null;
    updates.description = value;
    updates.descricao = value;
    updates.details = value;
  }

  if (data.status !== undefined) {
    updates.status = normalisePackageStatus(data.status);
  }

  if (data.code !== undefined) {
    const trimmedCode = typeof data.code === "string" ? data.code.trim() : "";
    const value = trimmedCode ? trimmedCode : null;
    updates.code = value;
    updates.codigo = value;
  }

  if (Object.keys(updates).length === 1) {
    return existing;
  }

  await ref.set(updates, { merge: true });
  const updatedSnap = await ref.get();
  if (!updatedSnap.exists) {
    throw new Error("Pacote não encontrado após atualização.");
  }
  const updated = mapPackageData(updatedSnap.id, (updatedSnap.data() ?? {}) as Record<string, unknown>);

  revalidateTag("packages:recent");
  revalidateTag("packages:services");
  revalidatePackageDetailCache(trimmedId);

  return updated;
}

export async function deletePackage(packageId: string): Promise<boolean> {
  const trimmedId = typeof packageId === "string" ? packageId.trim() : "";
  if (!trimmedId) {
    throw new Error("Pacote inválido.");
  }

  const ref = packagesCollection().doc(trimmedId);
  const snap = await ref.get();
  if (!snap.exists) {
    return false;
  }

  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];

  const servicesSnap = await servicesCollection().where("packageId", "==", trimmedId).get();
  servicesSnap.docs.forEach((doc) => {
    operations.push((batch) => {
      batch.set(
        doc.ref,
        {
          ...buildServiceAssignmentFields({ packageId: null, folderId: null }),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      );
    });
  });

  const foldersSnap = await foldersCollection().where("packageId", "==", trimmedId).get();
  const tokenUpdates: Promise<unknown>[] = [];
  foldersSnap.docs.forEach((doc) => {
    const data = doc.data() ?? {};
    const rawTokenId = typeof data.tokenId === "string" ? data.tokenId.trim() : "";
    const rawTokenCode = typeof data.tokenCode === "string" ? data.tokenCode.trim() : "";
    const tokenId = rawTokenId || rawTokenCode;
    if (tokenId) {
      tokenUpdates.push(
        accessTokensCollection()
          .doc(tokenId)
          .set(
            {
              active: false,
              status: "revoked",
              revoked: true,
              updatedAt: FieldValue.serverTimestamp(),
            },
            { merge: true },
          )
          .catch((error) => {
            console.error(
              `[packages] Falha ao revogar token ${tokenId} da pasta ${doc.id}`,
              error,
            );
          }),
      );
    }
    operations.push((batch) => {
      batch.delete(doc.ref);
    });
  });
  operations.push((batch) => batch.delete(ref));

  if (tokenUpdates.length) {
    await Promise.all(tokenUpdates);
  }

  await commitBatchOperations(operations);

  revalidateTag("packages:recent");
  revalidateTag("services:recent");
  revalidateTag("packages:services");
  revalidatePackageDetailCache(trimmedId);

  return true;
}
