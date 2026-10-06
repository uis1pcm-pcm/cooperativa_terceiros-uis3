"use server";

import { getAdmin } from "@/lib/firebaseAdmin";
import { PublicAccessError } from "@/lib/public-access";
import type {
  ChecklistItem,
  Service,
  ServiceStatus,
  ServiceUpdate,
} from "@/lib/types";
import { completeLegacyServiceStatusSummary, resolveCanonicalServiceStatus } from "@/lib/serviceStatus";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { revalidateTag, unstable_cache } from "next/cache";
import { recomputeServiceProgress } from "@/lib/progressHistoryServer";
import { chooseProgressUpdateStrategy, resolveStoredProgressWatermark } from "@/lib/progressUpdateStrategy";
import { buildServiceSearchFields } from "@/lib/serviceSearch";
import { buildServiceAssignmentFields } from "@/lib/serviceAssignment";
import { resolveCurrentProgress } from "@/lib/progressValidation";

const getDb = () => getAdmin().db;
const servicesCollection = () => getDb().collection("services");
const accessTokensCollection = () => getDb().collection("accessTokens");
const packagesCollection = () => getDb().collection("packages");
const foldersCollection = () => getDb().collection("packageFolders");

const SERVICE_CACHE_TTL_SECONDS = 180;
const SERVICE_LIST_CACHE_TTL_SECONDS = 300;
const SERVICE_DASHBOARD_CACHE_TTL_SECONDS = 300;
const DEFAULT_AVAILABLE_SERVICES_LIMIT = 200;
const MAX_AVAILABLE_SERVICES_LIMIT = 2_000;

type ChecklistSeed = { id: string; descricao: string; peso: number };

type CreateServicePayload = {
  os: string;
  oc: string | null;
  tag: string;
  equipamento: string;
  equipmentName?: string | null;
  setor: string | null;
  inicioPrevistoMillis: number;
  fimPrevistoMillis: number;
  horasPrevistas: number;
  empresaId: string | null;
  cnpj: string | null;
  status: ServiceStatus;
  checklist: ChecklistSeed[];
  description?: string | null;
  importKey?: string | null;
};

function normaliseAvailableServicesLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit)) {
    return DEFAULT_AVAILABLE_SERVICES_LIMIT;
  }
  const safeLimit = Math.floor(limit);
  return Math.max(1, Math.min(safeLimit, MAX_AVAILABLE_SERVICES_LIMIT));
}

function normaliseServiceMode(mode: ServiceMapMode | undefined): ServiceMapMode {
  return mode === "summary" ? "summary" : "full";
}

const serviceDetailCache = unstable_cache(
  async (serviceId: string) => {
    const snap = await servicesCollection().doc(serviceId).get();
    if (!snap.exists) return null;
    return mapServiceData(snap.id, (snap.data() ?? {}) as Record<string, unknown>);
  },
  ["services", "detail"],
  {
    revalidate: SERVICE_CACHE_TTL_SECONDS,
    tags: ["services:detail"],
  },
);

const serviceChecklistCache = unstable_cache(
  async (serviceId: string) => {
    const col = servicesCollection().doc(serviceId).collection("checklist");
    const snap = await col.orderBy("description", "asc").get();
    return snap.docs.map((doc) => mapChecklistDoc(serviceId, doc));
  },
  ["services", "checklist"],
  {
    revalidate: SERVICE_CACHE_TTL_SECONDS,
    tags: ["services:checklist"],
  },
);

function serviceUpdatesCache(serviceId: string, limit: number) {
  return unstable_cache(
    async () => {
      const updatesCol = servicesCollection().doc(serviceId).collection("updates");
      const snap = await updatesCol.orderBy("audit.submittedAt", "desc").limit(limit).get();
      return snap.docs.map((doc) => mapUpdateDoc(serviceId, doc));
    },
    ["services", "updates", serviceId, String(limit)],
    {
      revalidate: SERVICE_CACHE_TTL_SECONDS,
      tags: [`service:${serviceId}:updates`],
    },
  )();
}

function legacyServiceUpdatesCache(serviceId: string, limit: number) {
  return unstable_cache(
    async () => {
      const updatesCol = servicesCollection().doc(serviceId).collection("serviceUpdates");
      const snap = await updatesCol.orderBy("date", "desc").limit(limit).get();
      return snap.docs.map((doc) => mapLegacyServiceUpdateDoc(serviceId, doc));
    },
    ["services", "legacy-updates", serviceId, String(limit)],
    {
      revalidate: SERVICE_CACHE_TTL_SECONDS,
      tags: [`service:${serviceId}:legacy-updates`],
    },
  )();
}

const listAvailableOpenServicesCache = unstable_cache(
  async (limit: number, mode: ServiceMapMode) => fetchAvailableOpenServices(limit, mode),
  ["services", "available"],
  {
    revalidate: SERVICE_LIST_CACHE_TTL_SECONDS,
    tags: ["services:available"],
  },
);

const recentServicesCache = unstable_cache(
  async () => fetchRecentServices(),
  ["services", "recent"],
  {
    revalidate: SERVICE_DASHBOARD_CACHE_TTL_SECONDS,
    tags: ["services:recent"],
  },
);

const serviceStatusSummaryCache = unstable_cache(
  async () => fetchServiceStatusSummary(),
  ["services", "status-summary"],
  {
    revalidate: SERVICE_DASHBOARD_CACHE_TTL_SECONDS,
    tags: ["services:summary"],
  },
);

function revalidateServiceDashboardCaches() {
  revalidateTag("services:recent");
  revalidateTag("services:summary");
}

function revalidateServiceDetailCache(serviceId: string) {
  if (!serviceId) return;
  revalidateTag("services:detail");
  revalidateTag("services:available");
}

function revalidateServiceUpdateCaches(serviceId: string) {
  if (!serviceId) return;
  revalidateTag(`service:${serviceId}:updates`);
  revalidateTag(`service:${serviceId}:legacy-updates`);
}

function normaliseImportValue(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatDateKey(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "";
  const millis = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(millis)) return "";
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function computeServiceImportKey(input: {
  os: string;
  oc?: string | null;
  setor?: string | null;
  tag?: string | null;
  equipmentName?: string | null;
  plannedStart?: number | string | null;
  plannedEnd?: number | string | null;
  empresa?: string | null;
  cnpj?: string | null;
  description?: string | null;
  totalHours?: number | string | null;
  sourceRow?: number | string | null;
}) {
  const parts = [
    normaliseImportValue(input.os),
    normaliseImportValue(input.oc),
    normaliseImportValue(input.setor),
    normaliseImportValue(input.tag),
    normaliseImportValue(input.equipmentName),
    formatDateKey(input.plannedStart),
    formatDateKey(input.plannedEnd),
    normaliseImportValue(input.empresa),
    normaliseImportValue(input.cnpj),
    normaliseImportValue(input.description),
    normaliseImportValue(input.totalHours),
    normaliseImportValue(input.sourceRow),
  ].filter(Boolean);

  return parts.join("::");
}

export async function buildServiceImportKey(input: {
  os: string;
  oc?: string | null;
  setor?: string | null;
  tag?: string | null;
  equipmentName?: string | null;
  plannedStart?: number | string | null;
  plannedEnd?: number | string | null;
  empresa?: string | null;
  cnpj?: string | null;
  description?: string | null;
  totalHours?: number | string | null;
  sourceRow?: number | string | null;
}) {
  return computeServiceImportKey(input);
}

export async function createService(payload: CreateServicePayload) {
  const servicesCol = servicesCollection();
  const docRef = servicesCol.doc();
  const now = FieldValue.serverTimestamp();
  const checklist = Array.isArray(payload.checklist) ? payload.checklist : [];
  const equipmentName = (payload.equipmentName ?? payload.equipamento).trim();
  const description = (payload.description ?? "").trim();
  const importKey = (payload.importKey ?? "").trim();

  const serviceDoc: Record<string, unknown> = {
    os: payload.os,
    oc: payload.oc || null,
    tag: payload.tag,
    equipamento: payload.equipamento,
    equipmentName: equipmentName || payload.equipamento,
    setor: payload.setor || null,
    inicioPrevisto: Timestamp.fromMillis(payload.inicioPrevistoMillis),
    fimPrevisto: Timestamp.fromMillis(payload.fimPrevistoMillis),
    horasPrevistas: payload.horasPrevistas,
    empresaId: payload.empresaId,
    empresa: payload.empresaId,
    companyId: payload.empresaId,
    company: payload.empresaId,
    cnpj: payload.cnpj || null,
    status: payload.status,
    displayStatus: resolveCanonicalServiceStatus({
      id: docRef.id,
      os: payload.os,
      equipmentName: equipmentName || payload.equipamento,
      plannedStart: new Date(payload.inicioPrevistoMillis).toISOString(),
      plannedEnd: new Date(payload.fimPrevistoMillis).toISOString(),
      totalHours: payload.horasPrevistas,
      status: payload.status,
      progress: 0,
      createdAt: Date.now(),
    }),
    andamento: 0,
    checklist,
    hasChecklist: checklist.length > 0,
    hasLegacyServiceUpdates: false,
    description: description || null,
    importKey: importKey || null,
    createdAt: now,
    updatedAt: now,
    createdBy: "pcm",
    ...buildServiceAssignmentFields({ packageId: null, folderId: null }),
  };
  Object.assign(serviceDoc, buildServiceSearchFields(docRef.id, serviceDoc));

  await docRef.set(serviceDoc);

  if (checklist.length > 0) {
    const db = getDb();
    const batch = db.batch();
    const checklistCol = docRef.collection("checklist");

    checklist.forEach((item) => {
      const ref = checklistCol.doc(item.id);
      batch.set(ref, {
        description: item.descricao,
        weight: item.peso,
        progress: 0,
        status: "nao_iniciado",
        updatedAt: now,
      });
    });

    await batch.commit();
  }

  revalidateServiceDashboardCaches();
  return { id: docRef.id };
}

function toMillis(value: unknown | Timestamp | number | null | undefined) {
  if (typeof value === "number") return value;
  if (!value) return undefined;
  const ts = value as Timestamp | { toMillis?: () => number };
  if (typeof ts?.toMillis === "function") return ts.toMillis();
  return undefined;
}

function toIsoDate(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "number") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const possible = value as { toDate?: () => Date; toMillis?: () => number };
  if (typeof possible?.toDate === "function") {
    const date = possible.toDate();
    return !date || Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (typeof possible?.toMillis === "function") {
    const millis = possible.toMillis();
    if (typeof millis === "number" && Number.isFinite(millis)) {
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? "" : date.toISOString();
    }
  }
  return "";
}

function pickDateField(
  data: Record<string, unknown>,
  candidates: string[],
): string {
  for (const key of candidates) {
    if (!(key in data)) continue;
    const value = toIsoDate(data[key]);
    if (value) return value;
  }
  return "";
}

function inferChecklistStatus(progress: number): ChecklistItem["status"] {
  if (progress >= 100) return "concluido";
  if (progress > 0) return "andamento";
  return "nao_iniciado";
}

function normaliseChecklistStatus(value: unknown): ChecklistItem["status"] {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "-");

  if (raw.includes("conclu")) return "concluido";
  if (raw.includes("andamento") || raw.includes("andando")) return "andamento";
  return "nao_iniciado";
}

function sanitisePercent(value: number) {
  if (Number.isNaN(value)) return 0;
  // Preservar o valor exato digitado, apenas garantir que está no range válido
  // Não usar Math.round para evitar alterar valores como 20 para 18
  return Math.min(100, Math.max(0, value));
}

function resolveCurrentServicePercent(data: Record<string, unknown>): number {
  return resolveCurrentProgress(data);
}

type ServiceMapMode = "full" | "summary";

function mapServiceDoc(
  doc: FirebaseFirestore.DocumentSnapshot,
  mode: ServiceMapMode = "full",
): Service {
  return mapServiceData(doc.id, (doc.data() ?? {}) as Record<string, unknown>, mode);
}

function normaliseServiceStatus(value: unknown): ServiceStatus {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "concluido" || raw === "concluído" || raw === "encerrado") return "Concluído";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.trim().replace(/%$/, "").replace(",", ".");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) return parsed;
  }
  if (typeof value === "object" && value && "toMillis" in value) {
    const possible = (value as { toMillis?: () => number }).toMillis?.();
    if (typeof possible === "number" && Number.isFinite(possible)) return possible;
  }
  return undefined;
}

function mapChecklistItemData(data: Record<string, unknown>): ChecklistItem {
  const rawStatus = String(data.status ?? data.situacao ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-")
    .replace("em andamento", "em-andamento");

  const status: ChecklistItem["status"] = ((): ChecklistItem["status"] => {
    if (rawStatus === "em-andamento" || rawStatus === "andamento") return "em-andamento";
    if (rawStatus === "concluido" || rawStatus === "concluído") return "concluido";
    return "nao-iniciado";
  })();

  return {
    id: String(data.id ?? data.itemId ?? data.checklistId ?? crypto.randomUUID()),
    description: String(data.description ?? data.descricao ?? ""),
    weight: toNumber(data.weight ?? data.peso) ?? 0,
    progress: toNumber(data.progress ?? data.percentual ?? data.pct) ?? 0,
    status,
  };
}

function mapUpdateData(data: Record<string, unknown>): ServiceUpdate {
  const reportDate =
    toMillis(data.date) ??
    toMillis(data.reportDate) ??
    toNumber(data.date) ??
    toNumber(data.reportDate) ??
    undefined;
  const createdAt =
    toMillis(data.createdAt ?? data.created_at ?? data.timestamp) ??
    toNumber(data.createdAt ?? data.created_at ?? data.timestamp) ??
    reportDate ??
    Date.now();
  const percent = toNumber(
    data.percent ?? data.manualPercent ?? data.totalPct ?? data.realPercentSnapshot ?? data.pct,
  );

  return {
    id: String(data.id ?? crypto.randomUUID()),
    createdAt,
    date: reportDate ?? null,
    description: String(data.description ?? data.note ?? data.observacao ?? ""),
    percent: percent ?? undefined,
  };
}

function mapServiceData(
  id: string,
  data: Record<string, unknown>,
  mode: ServiceMapMode = "full",
): Service {
  const plannedStart = pickDateField(data, [
    "plannedStart",
    "inicioPrevisto",
    "inicioPlanejado",
    "dataInicio",
    "startDate",
  ]);
  const plannedEnd = pickDateField(data, [
    "plannedEnd",
    "fimPrevisto",
    "fimPlanejado",
    "dataFim",
    "endDate",
  ]);
  const totalHours =
    toNumber(
      data.totalHours ?? data.totalHoras ?? data.horasTotais ?? data.horasPrevistas ?? data.hours,
    ) ?? 0;
  const createdAt =
    toNumber(data.createdAt ?? data.created_at ?? data.criadoEm ?? data.createdAtMs) ?? Date.now();
  const includeDetails = mode === "full";

  const assignedRaw = data.assignedTo;
  let assignedTo: Service["assignedTo"] | undefined;
  if (assignedRaw && typeof assignedRaw === "object") {
    const companyId = (assignedRaw as Record<string, unknown>).companyId;
    const companyName = (assignedRaw as Record<string, unknown>).companyName;
    if (companyId || companyName) {
      assignedTo = {
        companyId: companyId ? String(companyId) : undefined,
        companyName: companyName ? String(companyName) : undefined,
      };
    }
  }

  if (!assignedTo) {
    const companyId = data.companyId ?? data.empresaId ?? data.company ?? data.empresa;
    const companyName = data.companyName ?? data.empresaNome ?? data.nomeEmpresa;
    if (companyId || companyName) {
      assignedTo = {
        companyId: companyId ? String(companyId) : undefined,
        companyName: companyName ? String(companyName) : undefined,
      };
    }
  }

  const checklist =
    includeDetails && Array.isArray(data.checklist)
      ? (data.checklist as Record<string, unknown>[]).map((item) => mapChecklistItemData(item))
      : undefined;

  const updates =
    includeDetails && Array.isArray(data.updates)
      ? (data.updates as Record<string, unknown>[]).map((item) => mapUpdateData(item))
      : undefined;

  // Campos legados podem ficar com um valor antigo quando a edição atualiza
  // somente `andamento` ou os campos de percentual mais recentes. Portanto,
  // não deixe `progress` (frequentemente legado) esconder o valor efetivo.
  const progress = toNumber(
    data.andamento ??
      data.percentualRealAtual ??
      data.realPercentSnapshot ??
      data.manualPercent ??
      data.realPercent ??
      data.progress ??
      data.percentual ??
      data.percent,
  );
  const updatedAt =
    toNumber(
      data.updatedAt ?? data.updated_at ?? data.atualizadoEm ?? data.updatedAtMs ?? data.updatedAtMillis,
    ) ?? createdAt;

  return {
    id,
    os: String(data.os ?? data.OS ?? data.ordemServico ?? id ?? ""),
    oc: data.oc ? String(data.oc) : undefined,
    tag: data.tag ? String(data.tag) : undefined,
    equipmentName: String(data.equipmentName ?? data.equipamento ?? data.equipment ?? ""),
    setor: data.setor ? String(data.setor) : undefined,
    sector: data.sector ? String(data.sector) : undefined,
    plannedStart,
    plannedEnd,
    totalHours,
    description: data.description
      ? String(data.description)
      : data.descricao
        ? String(data.descricao)
        : undefined,
    plannedDaily:
      includeDetails && Array.isArray(data.plannedDaily)
        ? (data.plannedDaily as unknown[]).map((value) => {
            const numeric = typeof value === "number" ? value : Number(value);
            return Number.isFinite(numeric) ? numeric : 0;
          })
        : undefined,
    status: normaliseServiceStatus(data.displayStatus ?? data.status),
    code: data.code ? String(data.code) : data.codigo ? String(data.codigo) : undefined,
    assignedTo,
    progress: progress ?? undefined,
    updates,
    checklist,
    createdAt,
    updatedAt,
    hasLegacyServiceUpdates:
      typeof data.hasLegacyServiceUpdates === "boolean" ? data.hasLegacyServiceUpdates : undefined,
    packageId: data.packageId ? String(data.packageId) : data.pacoteId ? String(data.pacoteId) : undefined,
    company: data.company ? String(data.company) : data.companyId ? String(data.companyId) : undefined,
    empresa: data.empresa ? String(data.empresa) : undefined,
    cnpj: data.cnpj ? String(data.cnpj) : undefined,
    andamento: progress ?? undefined,
    realPercent: progress ?? undefined,
    realPercentSnapshot: toNumber(data.realPercentSnapshot),
    percentualRealAtual: toNumber(data.percentualRealAtual),
    manualPercent: toNumber(data.manualPercent),
    displayStatus: normaliseServiceStatus(data.displayStatus ?? data.status),
    lastUpdateDate: toNumber(data.lastUpdateDate),
    lastProgressUpdateAt: toNumber(data.lastProgressUpdateAt),
    previousProgress:
      toNumber(data.previousProgress ?? data.progressBeforeConclusion ?? data.previousPercent) ?? null,
    importKey: data.importKey ? String(data.importKey) : undefined,
  };
}

function canonicalStatusFromData(
  id: string,
  current: Record<string, unknown>,
  patch: Record<string, unknown> = {},
) {
  return resolveCanonicalServiceStatus(mapServiceData(id, { ...current, ...patch }, "summary"));
}

export async function getServiceById(id: string): Promise<Service | null> {
  const trimmedId = typeof id === "string" ? id.trim() : "";
  if (!trimmedId) return null;

  return serviceDetailCache(trimmedId);
}

export async function getServicesByIds(
  ids: string[],
  options?: { mode?: ServiceMapMode },
): Promise<Service[]> {
  const uniqueIds = Array.from(
    new Set(ids.filter((id) => typeof id === "string" && id.trim().length > 0)),
  );
  if (!uniqueIds.length) return [];

  let db: FirebaseFirestore.Firestore;
  try {
    db = getDb();
  } catch (error) {
    if (isMissingAdminError(error)) {
      console.warn(
        "[services:getServicesByIds] Firebase Admin não está configurado. Retornando lista vazia.",
        error,
      );
      return [];
    }
    console.warn(
      "[services:getServicesByIds] Falha ao acessar o Firestore para buscar serviços. Retornando lista vazia.",
      error,
    );
    return [];
  }
  const collection = db.collection("services");
  const indexMap = new Map<string, number>();
  uniqueIds.forEach((id, index) => {
    indexMap.set(id, index);
  });

  const chunkSize = 50;
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    chunks.push(uniqueIds.slice(i, i + chunkSize));
  }

  const collected: Array<{ index: number; service: Service }> = [];

  try {
    await Promise.all(
      chunks.map(async (chunk) => {
        const refs = chunk.map((id) => collection.doc(id));
        const snapshots = await db.getAll(...refs);
        snapshots.forEach((snapshot) => {
          if (!snapshot.exists) return;
          const service = mapServiceData(
            snapshot.id,
            (snapshot.data() ?? {}) as Record<string, unknown>,
            options?.mode,
          );
          const index = indexMap.get(service.id);
          if (index === undefined) return;
          collected.push({ index, service });
        });
      }),
    );
  } catch (error) {
    if (isMissingAdminError(error)) {
      console.warn(
        "[services:getServicesByIds] Firebase Admin não está configurado. Retornando lista vazia.",
        error,
      );
      return [];
    }
    console.warn(
      "[services:getServicesByIds] Falha ao buscar serviços por ID. Retornando lista parcial.",
      error,
    );
  }

  collected.sort((a, b) => a.index - b.index);

  return collected.map((entry) => entry.service);
}

async function queryServicesByField(
  field: string,
  values: string[],
  options?: { mode?: ServiceMapMode },
): Promise<Service[]> {
  const uniqueValues = Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  );
  if (!uniqueValues.length) return [];

  let db: FirebaseFirestore.Firestore;
  try {
    db = getDb();
  } catch (error) {
    if (isMissingAdminError(error)) {
      console.warn(
        `[services:queryServicesByField] Firebase Admin não configurado ao consultar campo ${field}.`,
        error,
      );
      return [];
    }
    throw error;
  }

  const servicesCol = db.collection("services");
  const chunkSize = 10;
  const chunks: string[][] = [];
  for (let i = 0; i < uniqueValues.length; i += chunkSize) {
    chunks.push(uniqueValues.slice(i, i + chunkSize));
  }

  const results: Service[] = [];

  await Promise.all(
    chunks.map(async (chunk) => {
      const snap = await servicesCol.where(field, "in", chunk).get();
      snap.docs.forEach((doc) => {
        results.push(
          mapServiceData(doc.id, (doc.data() ?? {}) as Record<string, unknown>, options?.mode),
        );
      });
    }),
  );

  return results;
}

export async function findServicesByImportKeys(
  keys: string[],
  options?: { mode?: ServiceMapMode },
): Promise<Service[]> {
  return queryServicesByField("importKey", keys, options);
}

export async function findServicesByOsList(
  osList: string[],
  options?: { mode?: ServiceMapMode },
): Promise<Service[]> {
  return queryServicesByField("os", osList, options);
}

async function fetchRecentServices(): Promise<Service[]> {
  const snap = await servicesCollection().orderBy("updatedAt", "desc").limit(20).get();
  const services = snap.docs.map((doc) => mapServiceData(doc.id, (doc.data() ?? {}) as Record<string, unknown>));
  return services.sort((a, b) => (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0));
}

export async function listRecentServices(): Promise<Service[]> {
  return recentServicesCache();
}

export type ServiceStatusSummary = {
  total: number;
  open: number;
  pending: number;
  concluded: number;
};

async function fetchServiceStatusSummary(): Promise<ServiceStatusSummary | null> {
  try {
    const collection = servicesCollection();
    const [totalResult, openResult, pendingResult, concludedResult] = await Promise.all([
      collection.count().get(),
      collection.where("displayStatus", "==", "Aberto").count().get(),
      collection.where("displayStatus", "==", "Pendente").count().get(),
      collection.where("displayStatus", "==", "Concluído").count().get(),
    ]);
    const summary = {
      total: totalResult.data().count,
      open: openResult.data().count,
      pending: pendingResult.data().count,
      concluded: concludedResult.data().count,
    };

    if (summary.open + summary.pending + summary.concluded !== summary.total) {
      const completed = completeLegacyServiceStatusSummary(summary);
      console.error(
        `[services:getServiceStatusSummary] ${completed.open - summary.open} serviço(s) sem displayStatus canônico; contabilizados provisoriamente como abertos. Execute o backfill manual.`,
      );
      return completed;
    }
    return summary;
  } catch (error) {
    console.warn("[services:getServiceStatusSummary] Failed to count service statuses", error);
    return null;
  }
}

export async function getServiceStatusSummary(): Promise<ServiceStatusSummary | null> {
  return serviceStatusSummaryCache();
}

function isMissingAdminError(error: unknown) {
  if (error instanceof Error) {
    if (error.message === "FIREBASE_ADMIN_NOT_CONFIGURED") {
      return true;
    }
    if (error.cause && typeof error.cause === "object") {
      return isMissingAdminError(error.cause);
    }
  }
  return false;
}

async function fetchAvailableOpenServices(limit: number, mode: ServiceMapMode): Promise<Service[]> {
  try {
    const snapshot = await servicesCollection()
      .where("displayStatus", "in", ["Aberto", "Pendente"])
      .where("packageId", "==", null)
      .where("folderId", "==", null)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();
    return snapshot.docs.map((doc) =>
      mapServiceData(doc.id, (doc.data() ?? {}) as Record<string, unknown>, mode),
    );
  } catch (error) {
    if (isMissingAdminError(error)) {
      console.warn(
        "[services:listAvailableOpenServices] Firebase Admin não está configurado. Retornando lista vazia.",
        error,
      );
      return [];
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    const indexUnavailable = message.includes("index") || message.includes("failed-precondition");
    console.warn(indexUnavailable
      ? "[services:listAvailableOpenServices] Índice canônico indisponível; fallback legado temporário acionado."
      : "[services:listAvailableOpenServices] Consulta canônica falhou; fallback legado temporário acionado.");
  }

  try {
    const availableById = new Map<string, Service>();
    const fetchLimit = Math.min(Math.max(limit * 2, 50), MAX_AVAILABLE_SERVICES_LIMIT);
    let legacySnap: FirebaseFirestore.QuerySnapshot;
    try {
      legacySnap = await servicesCollection()
        .where("status", "in", ["Aberto", "Pendente", "aberto", "pendente"])
        .orderBy("createdAt", "desc")
        .limit(fetchLimit)
        .get();
    } catch {
      legacySnap = await servicesCollection().orderBy("createdAt", "desc").limit(fetchLimit).get();
    }
    const foldersSnap = await foldersCollection().get();
    const attachedToFolder = new Set<string>();
    foldersSnap.docs.forEach((folder) => {
      const data = folder.data() ?? {};
      [data.services, data.serviceIds, data.servicos].forEach((values) => {
        if (!Array.isArray(values)) return;
        values.forEach((value) => {
          if (typeof value === "string" && value.trim()) attachedToFolder.add(value.trim());
        });
      });
    });
    legacySnap.docs
      .map((doc) => mapServiceData(doc.id, (doc.data() ?? {}) as Record<string, unknown>, mode))
      .filter((service) =>
        (service.status === "Aberto" || service.status === "Pendente") &&
        !service.packageId?.trim() &&
        !attachedToFolder.has(service.id),
      )
      .forEach((service) => availableById.set(service.id, service));

    return [...availableById.values()]
      .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, limit);
  } catch (legacyError) {
    console.warn("[services:listAvailableOpenServices] Falha também na compatibilidade legada.", legacyError);
    return [];
  }
}

export async function listAvailableOpenServices(
  limit = DEFAULT_AVAILABLE_SERVICES_LIMIT,
  options?: { mode?: ServiceMapMode; disableCache?: boolean },
): Promise<Service[]> {
  const safeLimit = normaliseAvailableServicesLimit(limit);
  const mode = normaliseServiceMode(options?.mode);
  if (options?.disableCache) {
    return fetchAvailableOpenServices(safeLimit, mode);
  }
  return listAvailableOpenServicesCache(safeLimit, mode);
}

function mapChecklistDoc(
  serviceId: string,
  doc: FirebaseFirestore.QueryDocumentSnapshot,
): ChecklistItem {
  const data = doc.data() ?? {};
  return {
    id: doc.id,
    serviceId,
    description: data.description ?? "",
    weight: data.weight ?? 0,
    progress: data.progress ?? 0,
    status: (data.status ?? "nao_iniciado") as ChecklistItem["status"],
    updatedAt: toMillis(data.updatedAt),
  };
}

function mapEmbeddedChecklistItems(
  serviceId: string,
  data: Record<string, unknown>,
): ChecklistItem[] {
  const rawChecklist = [data.checklist, data.checklists, data.items].find((value) =>
    Array.isArray(value),
  ) as Array<Record<string, unknown>> | undefined;

  if (!rawChecklist?.length) return [];

  return rawChecklist
    .map((entry, index) => {
      if (!entry || typeof entry !== "object") return null;

      const idCandidates = [entry.id, entry.itemId, entry.checklistId, entry.codigo];
      const id = idCandidates
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value);

      const descriptionCandidates = [entry.description, entry.descricao, entry.nome];
      const description =
        descriptionCandidates
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .find((value) => value) || "Item do checklist";

      const weight = toNumber((entry as Record<string, unknown>).weight ?? entry.peso) ?? 0;
      const progress = sanitisePercent(
        toNumber((entry as Record<string, unknown>).progress ?? entry.percentual ?? entry.pct) ?? 0,
      );
      const status = normaliseChecklistStatus((entry as Record<string, unknown>).status);

      return {
        id: id || `item-${index}`,
        serviceId,
        description,
        weight,
        progress,
        status,
      };
    })
    .filter((item): item is ChecklistItem => Boolean(item));
}

function mapTimeWindow(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const start = toMillis(record.start);
  const end = toMillis(record.end);
  const hours = toNumber(record.hours);
  return {
    start: start ?? null,
    end: end ?? null,
    hours: Number.isFinite(hours ?? NaN) ? Number(hours) : start && end ? (end - start) / 3_600_000 : null,
  };
}

function mapSubactivity(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : null;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : null;
  if (!id && !label) return undefined;
  return { id, label };
}

function mapImpediments(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const type = typeof record.type === "string" ? record.type.trim() : "";
      if (!type) return null;
      const duration = toNumber(record.durationHours);
      return {
        type,
        durationHours: Number.isFinite(duration ?? NaN) ? Number(duration) : null,
      };
    })
    .filter(Boolean) as Array<{ type: string; durationHours?: number | null }>;
  return entries.length ? entries : undefined;
}

function mapResources(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const name = typeof record.name === "string" ? record.name.trim() : "";
      if (!name) return null;
      const quantity = toNumber(record.quantity);
      const numericQuantity = Number.isFinite(quantity ?? NaN) ? Number(quantity) : null;
      const unit = typeof record.unit === "string" && record.unit.trim() ? record.unit.trim() : null;
      return {
        name,
        quantity: numericQuantity && numericQuantity > 0 ? numericQuantity : null,
        unit,
      };
    })
    .filter(Boolean) as Array<{ name: string; quantity?: number | null; unit?: string | null }>;
  return entries.length ? entries : undefined;
}

function mapWorkforce(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const role = typeof record.role === "string" ? record.role.trim() : "";
      if (!role) return null;
      const quantity = toNumber(record.quantity);
      const normalisedQuantity = Number.isFinite(quantity ?? NaN) ? Math.max(1, Math.round(Number(quantity))) : null;
      if (!normalisedQuantity) return null;
      return { role, quantity: normalisedQuantity };
    })
    .filter(Boolean) as Array<{ role: string; quantity: number }>;
  return entries.length ? entries : undefined;
}

const SHIFT_VALUES = new Set(["manha", "tarde", "noite"]);
const WEATHER_VALUES = new Set(["claro", "nublado", "chuvoso"]);
const CONDITION_VALUES = new Set(["praticavel", "impraticavel"]);

function mapShiftConditions(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const shiftRaw = typeof record.shift === "string" ? record.shift.trim().toLowerCase() : "";
      const weatherRaw = typeof record.weather === "string" ? record.weather.trim().toLowerCase() : "";
      const conditionRaw = typeof record.condition === "string" ? record.condition.trim().toLowerCase() : "";
      if (!SHIFT_VALUES.has(shiftRaw) || !WEATHER_VALUES.has(weatherRaw) || !CONDITION_VALUES.has(conditionRaw)) {
        return null;
      }
      return {
        shift: shiftRaw as "manha" | "tarde" | "noite",
        weather: weatherRaw as "claro" | "nublado" | "chuvoso",
        condition: conditionRaw as "praticavel" | "impraticavel",
      };
    })
    .filter(Boolean) as Array<{
      shift: "manha" | "tarde" | "noite";
      weather: "claro" | "nublado" | "chuvoso";
      condition: "praticavel" | "impraticavel";
    }>;
  return entries.length ? entries : undefined;
}

function mapEvidences(value: unknown) {
  if (!Array.isArray(value)) return undefined;
  const entries = value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === "string" ? record.url.trim() : "";
      if (!url) return null;
      const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : null;
      return { url, label };
    })
    .filter(Boolean) as Array<{ url: string; label?: string | null }>;
  return entries.length ? entries : undefined;
}

function mapAudit(value: unknown) {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const submittedAt = toMillis(record.submittedAt);
  const previousPercent = toNumber(record.previousPercent);
  const newPercent = toNumber(record.newPercent);
  const submittedBy = typeof record.submittedBy === "string" && record.submittedBy.trim() ? record.submittedBy.trim() : null;
  const token = typeof record.token === "string" && record.token.trim() ? record.token.trim() : null;
  const ip = typeof record.ip === "string" && record.ip.trim() ? record.ip.trim() : null;
  const submittedByType = typeof record.submittedByType === "string" ? record.submittedByType : undefined;
  return {
    submittedBy,
    submittedByType: submittedByType === "user" || submittedByType === "token" || submittedByType === "system"
      ? submittedByType
      : undefined,
    submittedAt: submittedAt ?? null,
    previousPercent: Number.isFinite(previousPercent ?? NaN) ? Number(previousPercent) : null,
    newPercent: Number.isFinite(newPercent ?? NaN) ? Number(newPercent) : null,
    token,
    ip,
  };
}

function mapUpdateDoc(
  serviceId: string,
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot,
): ServiceUpdate {
  const data = (doc.data() ?? {}) as Record<string, unknown>;
  const manualPercent = toNumber(data.manualPercent) ?? undefined;
  const realPercent =
    toNumber(data.realPercentSnapshot) ??
    toNumber(data.realPercent) ??
    manualPercent ??
    0;
  const description = (() => {
    const raw = data.description ?? data.note;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : "";
    }
    return "";
  })();
  const percent = Number.isFinite(realPercent ?? NaN) ? Number(realPercent) : 0;

  const auditSubmittedAt = toMillis((data.audit as Record<string, unknown> | undefined)?.submittedAt);
  const reportDate =
    toMillis(data.date) ??
    toMillis(data.reportDate) ??
    toNumber(data.date) ??
    toNumber(data.reportDate) ??
    null;
  const submittedAt = auditSubmittedAt ?? toMillis(data.submittedAt) ?? null;
  const createdAt = toMillis(data.createdAt) ?? toNumber(data.createdAt) ?? submittedAt ?? reportDate ?? 0;

  return {
    id: doc.id,
    serviceId,
    token: typeof data.token === "string" ? data.token : undefined,
    manualPercent,
    realPercentSnapshot: percent,
    percent,
    description,
    timeWindow: mapTimeWindow(data.timeWindow),
    subactivity: mapSubactivity(data.subactivity),
    mode:
      (typeof data.mode === "string" &&
      (data.mode === "detailed" || data.mode === "simple"))
        ? (data.mode as "simple" | "detailed")
        : undefined,
    impediments: mapImpediments(data.impediments),
    resources: mapResources(data.resources),
    workforce: mapWorkforce(data.workforce),
    shiftConditions: mapShiftConditions(data.shiftConditions),
    forecastDate: toMillis(data.forecastDate) ?? null,
    criticality: toNumber(data.criticality) ?? null,
    evidences: mapEvidences(data.evidences),
    justification:
      typeof data.justification === "string"
        ? data.justification.trim() || null
        : null,
    previousPercent: toNumber(data.previousPercent) ?? null,
    declarationAccepted:
      typeof data.declarationAccepted === "boolean"
        ? data.declarationAccepted
        : undefined,
    audit: mapAudit(data.audit),
    submittedAt: submittedAt ?? undefined,
    // Data operacional selecionada pelo terceiro; é a referência da curva realizada.
    date: reportDate,
    createdAt,
  };
}

function mapLegacyServiceUpdateDoc(
  serviceId: string,
  doc: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot,
): ServiceUpdate {
  const data = doc.data() ?? {};

  const dateMillis = toMillis(data.date) ?? 0;
  const createdAtMillis = toMillis(data.createdAt) ?? dateMillis;
  const rawPercent = toNumber((data as Record<string, unknown>).totalPct);
  const percent = Number.isFinite(rawPercent ?? NaN)
    ? Math.max(0, Math.min(100, Number(rawPercent)))
    : 0;
  const note = typeof (data as Record<string, unknown>).note === "string" ? data.note.trim() : "";
  const tokenId =
    typeof data.tokenId === "string" && data.tokenId.trim()
      ? data.tokenId.trim()
      : undefined;
  const ip = typeof (data as Record<string, unknown>).ip === "string" ? data.ip.trim() : null;

  return {
    id: doc.id,
    serviceId,
    percent,
    realPercentSnapshot: percent,
    description: note,
    createdAt: createdAtMillis,
    // A data operacional é editável e deve alimentar as curvas do serviço,
    // pacote e subpacote, mesmo em documentos do formato legado.
    date: dateMillis || null,
    token: tokenId,
    audit: {
      submittedBy: tokenId ?? null,
      submittedByType: "token",
      token: tokenId,
      ip,
      submittedAt: createdAtMillis || null,
      newPercent: Number.isFinite(percent) ? percent : null,
      previousPercent: toNumber(data.previousPercent) ?? null,
    },
  };
}

export async function getService(serviceId: string): Promise<Service | null> {
  const trimmedId = typeof serviceId === "string" ? serviceId.trim() : "";
  if (!trimmedId) return null;

  return serviceDetailCache(trimmedId);
}

export async function getChecklist(
  serviceId: string,
): Promise<ChecklistItem[]> {
  const trimmedId = typeof serviceId === "string" ? serviceId.trim() : "";
  if (!trimmedId) return [];

  const checklist = await serviceChecklistCache(trimmedId);
  return checklist ?? [];
}

export async function setChecklistItems(
  serviceId: string,
  items: Array<{ description: string; weight: number }>,
): Promise<void> {
  const totalWeight = items.reduce((acc, item) => acc + (item.weight ?? 0), 0);
  if (items.length > 0 && Math.round(totalWeight) !== 100) {
    throw new Error("A soma dos pesos do checklist deve ser igual a 100.");
  }

  const { db } = getAdmin();
  await db.runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const checklistCol = serviceRef.collection("checklist");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new Error("Serviço não encontrado");
    }

    const existing = await tx.get(checklistCol);
    existing.docs.forEach((doc) => {
      tx.delete(doc.ref);
    });

    items.forEach((item) => {
      const ref = checklistCol.doc();
      tx.set(ref, {
        description: item.description,
        weight: item.weight,
        progress: 0,
        status: "nao_iniciado",
        updatedAt: FieldValue.serverTimestamp(),
      });
    });

    tx.update(serviceRef, {
      hasChecklist: items.length > 0,
      realPercent: 0,
      displayStatus: canonicalStatusFromData(serviceId, serviceSnap.data() ?? {}, {
        realPercent: 0,
      }),
      manualPercent: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp(),
    });
  });

  revalidateServiceDashboardCaches();
  revalidateTag("services:checklist");
  revalidateServiceDetailCache(serviceId);
}

type ServiceMetadataInput = {
  os: string;
  tag: string;
  equipment: string;
  oc?: string | null;
  sector?: string | null;
  company?: string | null;
  cnpj?: string | null;
  plannedStart: string;
  plannedEnd: string;
  totalHours: number;
  status: ServiceStatus;
};

function toDateOnlyTimestamp(value: string): Timestamp {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Data inválida.");
  }
  return Timestamp.fromDate(date);
}

type ChecklistProgressSnapshot = { id: string; progress: number; status?: ChecklistItem["status"] };

function computeWeightedChecklistPercent(items: ChecklistItem[]): number {
  const totalWeight = items.reduce((acc, item) => acc + (item.weight ?? 0), 0);
  if (!totalWeight) return 0;

  const percent =
    items.reduce((acc, item) => acc + (item.progress ?? 0) * (item.weight ?? 0), 0) / totalWeight;

  // Preservar valor calculado exato, apenas garantir que está no range válido
  return sanitisePercent(percent);
}

function mergeChecklistProgress(
  items: ChecklistItem[],
  updates: ChecklistProgressSnapshot[],
): ChecklistItem[] {
  const updateMap = new Map<string, ChecklistProgressSnapshot>();
  updates.forEach((update) => {
    if (!update?.id) return;
    updateMap.set(update.id, update);
  });

  return items.map((item) => {
    const override = updateMap.get(item.id);
    if (!override) return item;
    const progress = sanitisePercent(override.progress);
    const status = override.status ?? inferChecklistStatus(progress);
    return { ...item, progress, status };
  });
}

function resolveChecklistSnapshot(
  serviceData: Record<string, unknown>,
  items: ChecklistItem[],
): ChecklistProgressSnapshot[] {
  const storedSnapshot = Array.isArray(serviceData.checklistProgressBeforeConclusion)
    ? (serviceData.checklistProgressBeforeConclusion as Array<Record<string, unknown>>)
    : null;

  if (storedSnapshot?.length) {
    return storedSnapshot
      .map((entry) => {
        const id = typeof entry.id === "string" ? entry.id : "";
        const progress = Number(entry.progress);
        if (!id || !Number.isFinite(progress)) return null;
        const status = normaliseChecklistStatus(entry.status);
        return { id, progress, status };
      })
      .filter((entry): entry is ChecklistProgressSnapshot => Boolean(entry));
  }

  const fallbackPercent = toNumber(
    serviceData.progressBeforeConclusion ??
      serviceData.previousProgress ??
      serviceData.realPercent ??
      serviceData.andamento,
  );
  const clampedFallback = Number.isFinite(fallbackPercent ?? NaN)
    ? sanitisePercent(Number(fallbackPercent))
    : null;

  if (clampedFallback !== null) {
    return items.map((item) => ({
      id: item.id,
      progress: clampedFallback,
      status: inferChecklistStatus(clampedFallback),
    }));
  }

  return items.map((item) => ({
    id: item.id,
    progress: item.progress ?? 0,
    status: item.status ?? inferChecklistStatus(item.progress ?? 0),
  }));
}

export async function updateServiceMetadata(serviceId: string, input: ServiceMetadataInput): Promise<void> {
  const ref = servicesCollection().doc(serviceId);
  const db = getDb();

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      throw new Error("Serviço não encontrado");
    }

    const serviceData = (snap.data() ?? {}) as Record<string, unknown>;
    const previousStatus = normaliseServiceStatus(serviceData.status);
    const plannedStartTimestamp = toDateOnlyTimestamp(input.plannedStart);
    const plannedEndTimestamp = toDateOnlyTimestamp(input.plannedEnd);

    const payload: Record<string, unknown> = {
      os: input.os,
      tag: input.tag,
      equipamento: input.equipment,
      equipmentName: input.equipment,
      updatedAt: FieldValue.serverTimestamp(),
      inicioPrevisto: plannedStartTimestamp,
      fimPrevisto: plannedEndTimestamp,
      plannedStart: input.plannedStart,
      plannedEnd: input.plannedEnd,
      dataInicio: input.plannedStart,
      dataFim: input.plannedEnd,
      inicioPlanejado: input.plannedStart,
      fimPlanejado: input.plannedEnd,
      horasPrevistas: input.totalHours,
      totalHours: input.totalHours,
      totalHoras: input.totalHours,
      status: input.status,
    };

    payload.oc = input.oc ?? null;
    payload.sector = input.sector ?? null;
    payload.setor = input.sector ?? null;
    payload.empresaId = input.company ?? null;
    payload.company = input.company ?? null;
    payload.cnpj = input.cnpj ?? null;
    Object.assign(payload, buildServiceSearchFields(serviceId, { ...serviceData, ...payload }));

    const checklistRef = ref.collection("checklist");
    let checklistUpdates: ChecklistProgressSnapshot[] = [];

    if (input.status === "Concluído" && previousStatus !== "Concluído") {
      const checklistSnap = await tx.get(checklistRef);
      const items = checklistSnap.docs.map((doc) => mapChecklistDoc(serviceId, doc));
      const currentPercent = computeWeightedChecklistPercent(items);

      payload.progressBeforeConclusion =
        toNumber(serviceData.progressBeforeConclusion ?? serviceData.previousProgress ?? serviceData.realPercent) ??
        currentPercent;
      payload.previousProgress = payload.progressBeforeConclusion;
      payload.checklistProgressBeforeConclusion = items.map((item) => ({
        id: item.id,
        progress: item.progress ?? 0,
        status: item.status ?? inferChecklistStatus(item.progress ?? 0),
      }));
      payload.realPercent = 100;
      payload.andamento = 100;
      payload.manualPercent = FieldValue.delete();

      checklistUpdates = items.map((item) => ({
        id: item.id,
        progress: 100,
        status: "concluido",
      }));
    }

    if (input.status === "Pendente" && previousStatus === "Concluído") {
      const checklistSnap = await tx.get(checklistRef);
      const items = checklistSnap.docs.map((doc) => mapChecklistDoc(serviceId, doc));
      const snapshot = resolveChecklistSnapshot(serviceData, items);
      const merged = mergeChecklistProgress(items, snapshot);
      const restoredPercent = computeWeightedChecklistPercent(merged);

      payload.realPercent = restoredPercent;
      payload.andamento = restoredPercent;
      payload.manualPercent = FieldValue.delete();
      checklistUpdates = snapshot;
    }

    payload.displayStatus = canonicalStatusFromData(serviceId, serviceData, payload);

    tx.update(ref, payload);

    checklistUpdates.forEach((update) => {
      tx.update(checklistRef.doc(update.id), {
        progress: sanitisePercent(update.progress),
        status: update.status ?? inferChecklistStatus(update.progress),
        updatedAt: FieldValue.serverTimestamp(),
      });
    });
  });

  revalidateServiceDashboardCaches();
  revalidateTag("services:checklist");
  revalidateServiceDetailCache(serviceId);
}

export async function updateChecklistProgress(
  serviceId: string,
  updates: Array<{
    id: string;
    progress: number;
    status?: ChecklistItem["status"];
  }>,
  opts?: { preserveServiceProgress?: boolean },
): Promise<number> {
  if (!updates.length) {
    return computeRealPercentFromChecklist(serviceId);
  }

  function isSameUtcDay(leftMillis: number, rightMillis: number): boolean {
    const left = new Date(leftMillis);
    const right = new Date(rightMillis);
    return (
      left.getUTCFullYear() === right.getUTCFullYear() &&
      left.getUTCMonth() === right.getUTCMonth() &&
      left.getUTCDate() === right.getUTCDate()
    );
  }

  const { db } = getAdmin();
  const newPercent = await db.runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const checklistCol = serviceRef.collection("checklist");
    const updatesCol = serviceRef.collection("updates");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new PublicAccessError(404, "Serviço não encontrado");
    }
    const serviceData = (serviceSnap.data() ?? {}) as Record<string, unknown>;

    const checklistSnap = await tx.get(checklistCol);
    const itemsMap = new Map<string, ChecklistItem>();
    let shouldMarkHasChecklist = false;
    const checklistWrites: Array<{ id: string; op: "set" | "update"; data: Record<string, unknown> }> = [];

    if (checklistSnap.empty) {
      const embeddedItems = mapEmbeddedChecklistItems(serviceId, serviceData);

      if (embeddedItems.length === 0) {
        // Quando um serviço não tem checklist persistido, criar um item padrão para permitir
        // que o portal do terceiro registre a atualização sem estourar erro.
        const currentProgress = sanitisePercent(
          toNumber(serviceData.realPercent ?? serviceData.andamento ?? serviceData.progress) ?? 0,
        );
        const fallback: ChecklistItem = {
          id: "default-geral",
          serviceId,
          description: "GERAL",
          weight: 100,
          progress: currentProgress,
          status: inferChecklistStatus(currentProgress),
        };

        itemsMap.set(fallback.id, fallback);
        checklistWrites.push({
          id: fallback.id,
          op: "set",
          data: {
            description: fallback.description,
            weight: fallback.weight ?? 0,
            progress: fallback.progress ?? 0,
            status: fallback.status ?? inferChecklistStatus(fallback.progress ?? 0),
            updatedAt: FieldValue.serverTimestamp(),
          },
        });
        shouldMarkHasChecklist = true;
      } else {
        embeddedItems.forEach((item) => {
          itemsMap.set(item.id, item);
          checklistWrites.push({
            id: item.id,
            op: "set",
            data: {
              description: item.description,
              weight: item.weight ?? 0,
              progress: item.progress ?? 0,
              status: item.status ?? inferChecklistStatus(item.progress ?? 0),
              updatedAt: FieldValue.serverTimestamp(),
            },
          });
        });
        shouldMarkHasChecklist = true;
      }
    } else {
      checklistSnap.docs.forEach((doc) => {
        itemsMap.set(doc.id, mapChecklistDoc(serviceId, doc));
      });
      if (serviceData.hasChecklist !== true) {
        shouldMarkHasChecklist = true;
      }
    }

    updates.forEach((update) => {
      const existing = itemsMap.get(update.id);
      if (!existing) {
        throw new PublicAccessError(404, `Item do checklist ${update.id} não encontrado`);
      }
      const progress = sanitisePercent(update.progress);
      const status = update.status ?? inferChecklistStatus(progress);
      itemsMap.set(update.id, { ...existing, progress, status });

      checklistWrites.push({
        id: update.id,
        op: "update",
        data: {
          progress,
          status,
          updatedAt: FieldValue.serverTimestamp(),
        },
      });
    });

    const items = Array.from(itemsMap.values());
    const totalWeight = items.reduce((acc, item) => acc + (item.weight ?? 0), 0);
    const percent = totalWeight
      ? items.reduce(
          (acc, item) => acc + (item.progress ?? 0) * (item.weight ?? 0),
          0,
        ) / totalWeight
      : 0;
    // Preservar valor calculado exato do checklist, apenas garantir que está no range válido
    const realPercent = sanitisePercent(percent);

    const currentPercent = resolveCurrentServicePercent(serviceData);

    // Se houve lançamento manual recente, não sobrescrever o valor digitado ao atualizar o checklist.
    // Regra: quando o último update manual foi no mesmo dia (UTC) da atualização do checklist,
    // manter manualPercent como referência para o percentual exibido.
    const nowMillis = Date.now();
    let lastManual: { percent: number; submittedAt: number } | null = null;

    const latestUpdateSnap = await tx.get(updatesCol.orderBy("createdAt", "desc").limit(1));
    const latestDoc = latestUpdateSnap.docs[0];
    if (latestDoc) {
      const latestData = (latestDoc.data() ?? {}) as Record<string, unknown>;
      const manualPercent = toNumber(latestData.manualPercent);
      const submittedAt =
        toMillis((latestData.audit as Record<string, unknown> | undefined)?.submittedAt) ??
        toMillis(latestData.createdAt) ??
        toMillis(latestDoc.createTime) ??
        null;
      if (typeof manualPercent === "number" && Number.isFinite(manualPercent) && typeof submittedAt === "number") {
        lastManual = { percent: sanitisePercent(manualPercent), submittedAt };
      }
    }

    const shouldPreserveManual = Boolean(lastManual && isSameUtcDay(lastManual.submittedAt, nowMillis));
    const calculatedPercent = shouldPreserveManual ? (lastManual?.percent ?? realPercent) : realPercent;
    // O RDO manual é persistido logo após o checklist. Enquanto isso, manter o
    // progresso atual evita uma redução visual temporária entre as duas gravações.
    const resolvedPercent = opts?.preserveServiceProgress
      ? Math.max(currentPercent, calculatedPercent)
      : calculatedPercent;

    // Quando preservando manual, manter manualPercent setado; caso contrário, limpar manualPercent.
    const servicePatch = buildServiceProgressPatch(resolvedPercent, {
      manualPercent: shouldPreserveManual ? resolvedPercent : null,
    });
    if (shouldMarkHasChecklist) {
      servicePatch.hasChecklist = true;
    }
    servicePatch.displayStatus = canonicalStatusFromData(
      serviceId,
      serviceSnap.data() ?? {},
      servicePatch,
    );

    checklistWrites.forEach((write) => {
      const ref = checklistCol.doc(write.id);
      if (write.op === "set") {
        tx.set(ref, write.data);
      } else {
        tx.update(ref, write.data);
      }
    });

    tx.update(serviceRef, servicePatch);

    return realPercent;
  });

  revalidateServiceDashboardCaches();
  revalidateTag("services:checklist");
  revalidateServiceDetailCache(serviceId);

  return newPercent;
}

export async function computeRealPercentFromChecklist(
  serviceId: string,
): Promise<number> {
  const checklistCol = servicesCollection().doc(serviceId).collection("checklist");
  const snap = await checklistCol.get();
  if (snap.empty) return 0;

  const items = snap.docs.map((doc) => mapChecklistDoc(serviceId, doc));
  const totalWeight = items.reduce((acc, item) => acc + (item.weight ?? 0), 0);
  if (!totalWeight) return 0;

  const percent =
    items.reduce(
      (acc, item) => acc + (item.progress ?? 0) * (item.weight ?? 0),
      0,
    ) / totalWeight;
  // Preservar valor calculado exato, apenas garantir que está no range válido
  return sanitisePercent(percent);
}

type ManualUpdateInput = {
  manualPercent: number;
  description: string;
  token?: string;
  mode: "simple" | "detailed";
  declarationAccepted: boolean;
  reportDate?: number | null;
  timeWindow?: { start?: number | null; end?: number | null; hours?: number | null };
  subactivity?: { id?: string | null; label?: string | null };
  impediments?: Array<{ type: string; durationHours?: number | null }>;
  resources?: Array<{ name: string; quantity?: number | null; unit?: string | null }>;
  workforce?: Array<{ role: string; quantity: number }>;
  shiftConditions?: Array<{
    shift: "manha" | "tarde" | "noite";
    weather: "claro" | "nublado" | "chuvoso";
    condition: "praticavel" | "impraticavel";
  }>;
  forecastDate?: number | null;
  criticality?: number | null;
  evidences?: Array<{ url: string; label?: string | null }>;
  justification?: string | null;
  previousPercent?: number | null;
  ip?: string | null;
};

function buildComputedUpdatePayload(params: { realPercent: number; note?: string; token?: string }) {
  const payload: Record<string, unknown> = {
    realPercentSnapshot: params.realPercent,
    createdAt: FieldValue.serverTimestamp(),
  };

  if (typeof params.note === "string" && params.note.trim()) {
    payload.note = params.note.trim();
  }

  if (params.token) {
    payload.token = params.token;
  }

  return payload;
}

function buildServiceProgressPatch(percent: number, opts?: { manualPercent?: number | null }) {
  const progressValue = sanitisePercent(percent);
  const timestamp = FieldValue.serverTimestamp();

  const payload: Record<string, unknown> = {
    realPercent: progressValue,
    andamento: progressValue,
    progress: progressValue,
    percent: progressValue,
    percentualRealAtual: progressValue,
    realPercentSnapshot: progressValue,
    updatedAt: timestamp,
    lastUpdateDate: timestamp,
    // Estes campos são apenas o snapshot usado ao reabrir uma conclusão. Assim
    // que há um novo progresso válido, não podem continuar sobrepondo o RDO.
    previousProgress: FieldValue.delete(),
    progressBeforeConclusion: FieldValue.delete(),
    previousPercent: FieldValue.delete(),
  };

  if (opts?.manualPercent === null) {
    payload.manualPercent = FieldValue.delete();
  } else if (typeof opts?.manualPercent === "number") {
    payload.manualPercent = sanitisePercent(opts.manualPercent);
  }

  return payload;
}

function buildUpdatePayload(serviceId: string, params: ManualUpdateInput & { realPercent: number }) {
  const explicitDateMillis =
    typeof params.reportDate === "number" && Number.isFinite(params.reportDate) ? params.reportDate : null;
  const submittedAt = FieldValue.serverTimestamp();
  const reportDate = explicitDateMillis ? Timestamp.fromMillis(explicitDateMillis) : undefined;

  const payload: Record<string, unknown> = {
    realPercentSnapshot: params.realPercent,
    createdAt: submittedAt,
    date: reportDate,
    reportDate,
    description: params.description,
    manualPercent: params.manualPercent,
    percent: params.realPercent,
    mode: params.mode,
    declarationAccepted: params.declarationAccepted,
    serviceId,
  };

  if (params.token) payload.token = params.token;
  if (params.previousPercent !== undefined) {
    payload.previousPercent = Number.isFinite(params.previousPercent ?? NaN)
      ? Number(params.previousPercent)
      : null;
  }

  if (params.timeWindow) {
    const timeWindowPayload: Record<string, unknown> = {};
    if (typeof params.timeWindow.start === "number" && Number.isFinite(params.timeWindow.start)) {
      timeWindowPayload.start = Timestamp.fromMillis(params.timeWindow.start);
    }
    if (typeof params.timeWindow.end === "number" && Number.isFinite(params.timeWindow.end)) {
      timeWindowPayload.end = Timestamp.fromMillis(params.timeWindow.end);
    }
    if (typeof params.timeWindow.hours === "number" && Number.isFinite(params.timeWindow.hours)) {
      timeWindowPayload.hours = Number(params.timeWindow.hours);
    }
    if (Object.keys(timeWindowPayload).length > 0) {
      payload.timeWindow = timeWindowPayload;
    }
  }

  if (params.subactivity) {
    const { id, label } = params.subactivity;
    if ((id && id.trim()) || (label && label.trim())) {
      payload.subactivity = {
        id: id?.trim() || null,
        label: label?.trim() || null,
      };
    }
  }

  if (params.impediments?.length) {
    payload.impediments = params.impediments
      .slice(0, 5)
      .map((item) => ({
        type: item.type.trim(),
        durationHours:
          typeof item.durationHours === "number" && Number.isFinite(item.durationHours)
            ? Number(item.durationHours)
            : null,
      }));
  }

  if (params.resources?.length) {
    payload.resources = params.resources
      .slice(0, 8)
      .map((item) => ({
        name: item.name.trim(),
        quantity:
          typeof item.quantity === "number" && Number.isFinite(item.quantity) && item.quantity > 0
            ? Number(item.quantity)
            : null,
        unit: item.unit?.trim() || null,
      }));
  }

  if (params.workforce?.length) {
    payload.workforce = params.workforce
      .map((item) => ({
        role: item.role.trim(),
        quantity: Math.max(1, Math.round(Number(item.quantity))),
      }))
      .filter((item) => item.role && Number.isFinite(item.quantity))
      .slice(0, 12);
  }

  if (params.shiftConditions?.length) {
    payload.shiftConditions = params.shiftConditions
      .map((item) => {
        const shift = item.shift.trim().toLowerCase();
        const weather = item.weather.trim().toLowerCase();
        const condition = item.condition.trim().toLowerCase();
        if (!SHIFT_VALUES.has(shift) || !WEATHER_VALUES.has(weather) || !CONDITION_VALUES.has(condition)) {
          return null;
        }
        return { shift, weather, condition };
      })
      .filter(Boolean)
      .slice(0, 2);
  }

  if (params.forecastDate && Number.isFinite(params.forecastDate)) {
    payload.forecastDate = Timestamp.fromMillis(params.forecastDate);
  }

  if (typeof params.criticality === "number" && Number.isFinite(params.criticality)) {
    payload.criticality = Math.round(Math.max(1, Math.min(5, params.criticality)));
  }

  if (params.evidences?.length) {
    payload.evidences = params.evidences
      .slice(0, 5)
      .map((item) => ({
        url: item.url.trim(),
        label: item.label?.trim() || null,
      }));
  }

  if (typeof params.justification === "string" && params.justification.trim()) {
    payload.justification = params.justification.trim();
  }

  const audit: Record<string, unknown> = { submittedAt, newPercent: params.realPercent };
  if (params.token) {
    audit.submittedByType = "token";
    audit.submittedBy = params.token;
    audit.token = params.token;
  } else {
    audit.submittedByType = "system";
  }
  if (params.previousPercent !== undefined) {
    audit.previousPercent = Number.isFinite(params.previousPercent ?? NaN)
      ? Number(params.previousPercent)
      : null;
  }
  if (params.ip) {
    audit.ip = params.ip;
  }
  payload.audit = audit;

  return payload;
}

export async function addManualUpdate(
  serviceId: string,
  input: ManualUpdateInput,
  opts?: { skipRecompute?: boolean },
): Promise<{ realPercent: number; update: ServiceUpdate }> {
  const percent = sanitisePercent(input.manualPercent);
  const description = input.description.trim();
  const mode = input.mode === "detailed" ? "detailed" : "simple";

  const { db } = getAdmin();
  const result = await db.runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const updatesCol = serviceRef.collection("updates");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new Error("Serviço não encontrado");
    }

    const serviceData = (serviceSnap.data() ?? {}) as Record<string, unknown>;
    const previousWatermark = resolveStoredProgressWatermark(toMillis(serviceData.lastProgressUpdateAt));
    const strategy = chooseProgressUpdateStrategy(input.reportDate, previousWatermark);
    const eventMillis = Math.max(input.reportDate ?? Date.now(), previousWatermark ?? 0);
    const updateRef = updatesCol.doc();
    tx.set(
      updateRef,
      buildUpdatePayload(serviceId, {
        ...input,
        manualPercent: percent,
        realPercent: percent,
        description,
        mode,
      }),
    );

    const servicePatch = buildServiceProgressPatch(percent, { manualPercent: percent });
    // Um rebuild que falhar não pode promover uma data ainda não reconstruída a
    // watermark. No fast path, update e watermark são persistidos atomicamente.
    if (strategy === "fast-path") {
      servicePatch.lastProgressUpdateAt = Timestamp.fromMillis(eventMillis);
    }
    servicePatch.displayStatus = canonicalStatusFromData(
      serviceId,
      serviceData,
      servicePatch,
    );
    tx.update(serviceRef, servicePatch);

    return { updateId: updateRef.id, strategy };
  });

  const updateSnap = await servicesCollection()
    .doc(serviceId)
    .collection("updates")
    .doc(result.updateId)
    .get();

  const mapped = mapUpdateDoc(serviceId, updateSnap);

  // O lançamento cronologicamente novo já atualizou update + serviço na mesma
  // transação. Apenas entradas retroativas precisam do rebuild linear completo.
  const shouldRebuild = result.strategy === "rebuild" && opts?.skipRecompute !== true;
  const rebuilt = shouldRebuild
    ? await recomputeServiceProgress(serviceId).catch((error) => {
        console.error(`[services] Falha ao recalcular progresso do serviço ${serviceId}`, error);
        return null;
      })
    : null;
  const resolvedPercent = rebuilt?.percent ?? mapped.realPercentSnapshot ?? percent;

  // Invalidar apenas os caches diretamente relacionados às atualizações do serviço
  revalidateServiceDashboardCaches();
  revalidateServiceUpdateCaches(serviceId);
  revalidateServiceDetailCache(serviceId);

  return { realPercent: resolvedPercent, update: mapped };
}

export async function removeEvidenceFromUpdate(
  serviceId: string,
  updateId: string,
  evidenceUrl: string,
): Promise<boolean> {
  const normalizedServiceId = serviceId.trim();
  const normalizedUpdateId = updateId.trim();
  const normalizedUrl = evidenceUrl.trim();
  if (!normalizedServiceId || !normalizedUpdateId || !normalizedUrl) return false;

  const { db } = getAdmin();
  const updateRef = db.collection("services").doc(normalizedServiceId).collection("updates").doc(normalizedUpdateId);
  const snap = await updateRef.get();
  if (!snap.exists) return false;

  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const source = Array.isArray(data.evidences) ? data.evidences : [];
  const filtered = source.filter((item) => {
    if (typeof item === "string") return item.trim() !== normalizedUrl;
    if (!item || typeof item !== "object") return true;
    const maybeUrl = typeof (item as { url?: unknown }).url === "string" ? String((item as { url?: unknown }).url).trim() : "";
    return maybeUrl !== normalizedUrl;
  });

  await updateRef.update({ evidences: filtered });
  revalidateServiceDetailCache(normalizedServiceId);
  return true;
}

export async function addComputedUpdate(
  serviceId: string,
  realPercent: number,
  note?: string,
  token?: string,
): Promise<string> {
  const percent = sanitisePercent(realPercent);
  const { db } = getAdmin();
  const updateId = await db.runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const updatesCol = serviceRef.collection("updates");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new Error("Serviço não encontrado");
    }

    const updateRef = updatesCol.doc();
    tx.set(
      updateRef,
      buildComputedUpdatePayload({
        note,
        token,
        realPercent: percent,
      }),
    );

    const serviceUpdate = buildServiceProgressPatch(percent, { manualPercent: null });

    if (percent >= 100) {
      serviceUpdate.status = "concluido";
    }
    serviceUpdate.displayStatus = canonicalStatusFromData(
      serviceId,
      serviceSnap.data() ?? {},
      serviceUpdate,
    );

    tx.update(serviceRef, serviceUpdate);

    return updateRef.id;
  });

  revalidateServiceDashboardCaches();
  revalidateServiceUpdateCaches(serviceId);
  revalidateServiceDetailCache(serviceId);

  return updateId;
}

export async function listUpdates(
  serviceId: string,
  limit = 50,
  hasLegacyServiceUpdates?: boolean,
): Promise<ServiceUpdate[]> {
  const trimmedId = typeof serviceId === "string" ? serviceId.trim() : "";
  if (!trimmedId) return [];

  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), 200) : 50;

  const updatesPromise = serviceUpdatesCache(trimmedId, safeLimit);
  // Ausência do marcador é deliberadamente tratada como desconhecida e mantém
  // a consulta legada até a execução do backfill.
  const legacyPromise = hasLegacyServiceUpdates === false
    ? Promise.resolve([] as ServiceUpdate[])
    : legacyServiceUpdatesCache(trimmedId, safeLimit);
  const [updates, legacyUpdates] = await Promise.all([updatesPromise, legacyPromise]);

  return [...(updates ?? []), ...(legacyUpdates ?? [])]
    // A ordem visível e a ordem usada pelos agregados devem acompanhar a data
    // operacional editável; `createdAt` representa apenas quando foi enviado.
    .sort((a, b) => (b.date ?? b.createdAt ?? 0) - (a.date ?? a.createdAt ?? 0))
    .slice(0, safeLimit);
}

export async function listServices(filter?: {
  status?: ServiceStatus;
  company?: string;
  packageId?: string;
}): Promise<Service[]> {
  let query: FirebaseFirestore.Query = servicesCollection();
  if (filter?.status) {
    query = query.where("status", "==", filter.status);
  }
  if (filter?.company) {
    query = query.where("company", "==", filter.company);
  }
  if (filter?.packageId) {
    query = query.where("packageId", "==", filter.packageId);
  }
  query = query.orderBy("createdAt", "desc");
  const snap = await query.get();
  return snap.docs.map((doc) => mapServiceDoc(doc));
}

async function deleteSubcollection(
  ref: FirebaseFirestore.DocumentReference,
  name: string,
): Promise<void> {
  const snap = await ref.collection(name).get();
  if (snap.empty) return;
  await Promise.all(snap.docs.map((doc) => doc.ref.delete()));
}

async function revokeServiceTokens(serviceId: string): Promise<number> {
  if (!serviceId) return 0;

  const snap = await accessTokensCollection()
    .where("targetType", "==", "service")
    .where("targetId", "==", serviceId)
    .get();

  if (snap.empty) return 0;

  const now = FieldValue.serverTimestamp();
  const batch = getDb().batch();

  snap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      { active: false, revoked: true, status: "revoked", updatedAt: now },
      { merge: true },
    );
  });

  await batch.commit();
  return snap.size;
}

async function collectFolderRefsByServiceId(serviceId: string): Promise<FirebaseFirestore.DocumentSnapshot[]> {
  if (!serviceId) return [];

  const foldersCol = foldersCollection();
  const queries = [
    foldersCol.where("services", "array-contains", serviceId),
    foldersCol.where("serviceIds", "array-contains", serviceId),
    foldersCol.where("servicos", "array-contains", serviceId),
  ];

  const collected = new Map<string, FirebaseFirestore.DocumentSnapshot>();
  await Promise.all(
    queries.map(async (query) => {
      const snap = await query.get();
      snap.docs.forEach((doc) => {
        collected.set(doc.id, doc);
      });
    }),
  );

  return Array.from(collected.values());
}

async function detachServiceFromPackagesAndFolders(
  serviceId: string,
  serviceData: Record<string, unknown>,
): Promise<void> {
  // Remove vinculações em pacotes/pastas para não deixar IDs órfãos no Firebase.
  const operations: Array<(batch: FirebaseFirestore.WriteBatch) => void> = [];
  const packageIdRaw =
    (typeof serviceData.packageId === "string" && serviceData.packageId.trim()) ||
    (typeof serviceData.pacoteId === "string" && serviceData.pacoteId.trim()) ||
    "";

  if (packageIdRaw) {
    const pkgRef = packagesCollection().doc(packageIdRaw);
    operations.push((batch) =>
      batch.set(
        pkgRef,
        {
          serviceIds: FieldValue.arrayRemove(serviceId),
          services: FieldValue.arrayRemove(serviceId),
          servicos: FieldValue.arrayRemove(serviceId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    );
  }

  const folders = await collectFolderRefsByServiceId(serviceId);
  folders.forEach((doc) => {
    operations.push((batch) =>
      batch.set(
        doc.ref,
        {
          services: FieldValue.arrayRemove(serviceId),
          serviceIds: FieldValue.arrayRemove(serviceId),
          servicos: FieldValue.arrayRemove(serviceId),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true },
      ),
    );
  });

  if (!operations.length) return;

  const db = getDb();
  // Commit in chunks to avoid exceeding batch limits while ensuring Firebase stays in sync with system deletions.
  const chunkSize = 300;
  for (let index = 0; index < operations.length; index += chunkSize) {
    const batch = db.batch();
    operations.slice(index, index + chunkSize).forEach((operation) => operation(batch));
    await batch.commit();
  }
}

export async function deleteService(serviceId: string): Promise<boolean> {
  const ref = servicesCollection().doc(serviceId);
  const snap = await ref.get();
  if (!snap.exists) {
    return false;
  }

  const serviceData = (snap.data() ?? {}) as Record<string, unknown>;

  await revokeServiceTokens(serviceId).catch((error) => {
    console.error(`[services] Falha ao revogar tokens do serviço ${serviceId}`, error);
    throw error;
  });

  await detachServiceFromPackagesAndFolders(serviceId, serviceData).catch((error) => {
    console.error(`[services] Falha ao remover referências do serviço ${serviceId} em pacotes/pastas`, error);
    throw error;
  });

  await deleteSubcollection(ref, "checklist").catch((error) => {
    console.error(`[services] Falha ao excluir checklist do serviço ${serviceId}`, error);
    throw error;
  });
  await deleteSubcollection(ref, "updates").catch((error) => {
    console.error(`[services] Falha ao excluir updates do serviço ${serviceId}`, error);
    throw error;
  });
  await deleteSubcollection(ref, "serviceUpdates").catch((error) => {
    console.error(`[services] Falha ao excluir serviceUpdates do serviço ${serviceId}`, error);
    throw error;
  });

  await ref.delete();
  revalidateServiceDashboardCaches();
  revalidateTag("services:checklist");
  revalidateServiceUpdateCaches(serviceId);
  revalidateServiceDetailCache(serviceId);
  revalidateTag("packages:detail");
  revalidateTag("packages:summary");
  revalidateTag("packages:services");
  revalidateTag("folders:detail");
  revalidateTag("folders:by-package");
  return true;
}
