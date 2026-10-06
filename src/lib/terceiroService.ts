// server-only
import "server-only";
import type { Firestore } from "firebase-admin/firestore";

import { getAdminDbOrThrow } from "@/lib/serverDb";
import { collectFolderServiceIds } from "@/lib/folderServices";

type ServiceDoc = {
  id: string;
  os?: string;
  oc?: string;
  tag?: string;
  equipamento?: string;
  setor?: string;
  status?: string;
  andamento?: number;
  packageId?: string | null;
  empresa?: string | null;
  cnpj?: string | null;
  description?: string | null;
};

export type TokenDoc = { id: string } & Record<string, unknown>;

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function mapServiceDoc(id: string, raw: Record<string, unknown>): ServiceDoc {
  return {
    id,
    os: toOptionalString(raw.os),
    oc: toOptionalString(raw.oc),
    tag: toOptionalString(raw.tag),
    equipamento: toOptionalString(raw.equipamento ?? raw.equipmentName),
    setor: toOptionalString(raw.setor),
    status: toOptionalString(raw.status),
    andamento: toOptionalNumber(raw.andamento ?? raw.progress ?? raw.realPercent),
    packageId: toOptionalString(raw.packageId ?? raw.pacoteId) ?? null,
    empresa: toOptionalString(raw.empresa ?? raw.empresaId ?? raw.company ?? raw.companyId) ?? null,
    cnpj: toOptionalString(raw.cnpj) ?? null,
    description: toOptionalString(raw.description ?? raw.descricao) ?? null,
  };
}

async function findTokenSnapshot(db: Firestore, token: string) {
  const normalised = token.trim().toUpperCase();
  const collection = db.collection("accessTokens");

  const direct = await collection.doc(normalised).get();
  if (direct.exists) {
    return direct;
  }

  const byCode = await collection.where("code", "==", normalised).limit(1).get();
  if (!byCode.empty) {
    return byCode.docs[0];
  }

  const legacy = await collection.where("token", "==", normalised).limit(1).get();
  if (!legacy.empty) {
    return legacy.docs[0];
  }

  return null;
}

export async function getTokenDoc(token: string) {
  if (!token) return null;
  const adminDb = getAdminDbOrThrow();
  const snapshot = await findTokenSnapshot(adminDb, token);
  if (!snapshot) return null;
  const data = snapshot.data() ?? {};
  return { id: snapshot.id, ...(data as Record<string, unknown>) } as TokenDoc;
}

export async function getServicesForToken(token: string): Promise<ServiceDoc[]> {
  const adminDb = getAdminDbOrThrow();
  const tokenDoc = await findTokenSnapshot(adminDb, token);
  if (!tokenDoc) return [];

  const data = (tokenDoc.data() ?? {}) as Record<string, unknown>;
  const serviceId = toOptionalString(data.serviceId) ?? toOptionalString(data.targetId);
  if (serviceId) {
    const doc = await adminDb.collection("services").doc(serviceId).get();
    if (!doc.exists) return [];
    const serviceData = (doc.data() ?? {}) as Record<string, unknown>;
    return [mapServiceDoc(doc.id, serviceData)];
  }

  const folderId =
    toOptionalString(data.folderId) ??
    toOptionalString(data.pastaId) ??
    (data.targetType === "folder" ? toOptionalString(data.targetId) : undefined);
  if (folderId) {
    return getServicesForFolder(adminDb, folderId);
  }

  return [];
}

async function getServicesForFolder(adminDb: Firestore, folderId: string): Promise<ServiceDoc[]> {
  const folderSnap = await adminDb.collection("packageFolders").doc(folderId).get();
  if (!folderSnap.exists) return [];

  const folderData = (folderSnap.data() ?? {}) as Record<string, unknown>;

  const serviceIds = collectFolderServiceIds({
    services: folderData.services,
    serviceIds: (folderData as Record<string, unknown>).serviceIds,
    servicos: (folderData as Record<string, unknown>).servicos,
  });

  if (!serviceIds.length) return [];

  const services: ServiceDoc[] = [];
  for (const serviceId of serviceIds) {
    const snap = await adminDb.collection("services").doc(serviceId).get();
    if (!snap.exists) continue;
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    services.push(mapServiceDoc(snap.id, data));
  }

  return services;
}
