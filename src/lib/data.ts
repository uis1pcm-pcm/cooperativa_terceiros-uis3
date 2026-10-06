import "server-only";
import { FieldPath, Timestamp, type Query, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { getAdminDbOrThrow } from "@/lib/serverDb";
import { serviceSearchMatches } from "@/lib/serviceSearch";
import type { PCMPackageListItem, PCMListResponse, PCMServiceListItem } from "@/types/pcm";

// Normaliza status (aceita "ABERTO", "aberto", etc.)
export function normStatus(s?: string | null) {
  const v = (s ?? "").toString().trim().toLowerCase();
  if (v === "concluido" || v === "concluído" || v === "encerrado") return "Concluído";
  if (v === "pendente") return "Pendente";
  return "Aberto";
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

type ListCursor = { updatedAt: number; id: string };

function encodeCursor(cursor: ListCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(value: string): ListCursor | null {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<ListCursor>;
    return typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt) && typeof parsed.id === "string"
      ? { updatedAt: parsed.updatedAt, id: parsed.id }
      : null;
  } catch { return null; }
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const cleaned = value.trim().replace(/%$/, "").replace(",", ".");
    const parsed = Number(cleaned);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return 0;
}

function toNumberOptional(...values: Array<unknown>): number | null {
  for (const value of values) {
    if (value === undefined || value === null || value === "") continue;
    const parsed = toNumber(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

// Mapeia doc -> objeto comum
function toTimestamp(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  if (value && typeof value === "object") {
    const source = value as { toMillis?: () => number };
    if (typeof source.toMillis === "function") {
      const millis = source.toMillis();
      if (typeof millis === "number" && Number.isFinite(millis)) {
        return millis;
      }
    }
  }
  return null;
}

function toSerializableDate(value: unknown): number | string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  const timestamp = toTimestamp(value);
  if (timestamp !== null) return timestamp;

  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }

  return null;
}

function mapDoc(id: string, rawData: Record<string, unknown> | undefined): PCMServiceListItem {
  const data = rawData ?? {};
  const result: PCMServiceListItem & Record<string, unknown> = {
    id,
    os: toOptionalString(data.os) ?? toOptionalString(data.O_S) ?? toOptionalString(data.OS),
    oc: toOptionalString(data.oc) ?? toOptionalString(data.O_C) ?? toOptionalString(data.OC),
    tag: toOptionalString(data.tag),
    code: toOptionalString(data.code) ?? toOptionalString(data.codigo),
    equipamento: toOptionalString(data.equipamento) ?? toOptionalString(data.nomeEquipamento),
    equipmentName:
      toOptionalString(data.equipmentName) ??
      toOptionalString(data.nomeEquipamento) ??
      toOptionalString(data.equipamento),
    setor: toOptionalString(data.setor),
    sector: toOptionalString(data.sector) ?? toOptionalString(data.setor),
    status: normStatus(toOptionalString(data.status)),
    packageId: toOptionalString(data.packageId) ?? toOptionalString(data.pacoteId),
    empresa: toOptionalString(data.empresa) ?? toOptionalString(data.empresaId) ?? toOptionalString(data.company),
    company: toOptionalString(data.company) ?? toOptionalString(data.empresa),
    createdAt:
      toTimestamp(data.createdAt ?? data.created_at ?? data.criadoEm ?? data.createdAtMs ?? data.createdAtMillis) ??
      null,
    updatedAt:
      toTimestamp(data.updatedAt ?? data.updated_at ?? data.atualizadoEm ?? data.updatedAtMs ?? data.updatedAtMillis) ??
      null,
    plannedStart:
      toSerializableDate(
        data.plannedStart ??
          data.dataInicio ??
          data.inicioPrevisto ??
          data.inicioPlanejado ??
          data.startDate ??
          null,
      ),
    plannedEnd:
      toSerializableDate(
        data.plannedEnd ??
          data.dataFim ??
          data.fimPrevisto ??
          data.fimPlanejado ??
          data.endDate ??
          null,
      ),
    plannedDaily: Array.isArray(data.plannedDaily)
      ? (data.plannedDaily as unknown[]).filter(
          (value): value is number => typeof value === "number" && Number.isFinite(value),
        )
      : null,
  };

  const andamento = toNumberOptional(
    data.andamento,
    data.realPercent,
    data.realPercentSnapshot,
    data.percent,
    data.progress,
  );
  if (andamento !== null) {
    result.andamento = andamento;
  }

  const progress = toNumberOptional(data.progress, data.percent);
  if (progress !== null) {
    result.progress = progress;
  }

  const realPercent = toNumberOptional(data.realPercent, data.realPercentSnapshot, data.percent);
  if (realPercent !== null) {
    result.realPercent = realPercent;
  }

  const manualPercent = toNumberOptional(
    data.manualPercent,
    data.manual_percent,
    data.manualProgress,
  );
  if (manualPercent !== null) {
    result.manualPercent = manualPercent;
  }

  const dateFields = [
    "dataInicio",
    "inicioPrevisto",
    "inicioPlanejado",
    "startDate",
    "dataFim",
    "fimPrevisto",
    "fimPlanejado",
    "endDate",
  ];

  for (const field of dateFields) {
    if (data[field] !== undefined) {
      const serialised = toSerializableDate(data[field]);
      if (serialised !== null) {
        result[field] = serialised;
      }
    }
  }

  const progressFields = [
    "percentualReal",
    "percentualRealAtual",
    "percentualInformado",
    "progressoReal",
    "realProgress",
    "currentProgress",
    "percentual",
    "manualProgress",
  ];

  for (const field of progressFields) {
    if (data[field] !== undefined) {
      result[field] = data[field];
    }
  }

  const updateListFields = [
    "atualizacoes",
    "historicoAtualizacoes",
    "historico",
    "history",
    "updates",
    "progressUpdates",
    "percentualUpdates",
    "realUpdates",
  ];

  for (const field of updateListFields) {
    if (Array.isArray(data[field])) {
      result[field] = data[field];
    }
  }

  return result;
}

/** Lista serviços com filtros e paginação para o PCM. */
export async function listServicesPCM(options?: {
  limit?: number;
  cursor?: string | null;
  status?: string | null;
  empresa?: string | null;
  search?: string | null;
}): Promise<PCMListResponse<PCMServiceListItem>> {
  try {
    const admin = getAdminDbOrThrow();
    const {
      limit = 10,
      cursor = null,
      status,
      empresa,
      search,
    } = options ?? {};
    const searchTerm = search?.trim() ?? "";

    let query: Query = admin.collection("services");

    if (status) {
      query = query.where("status", "==", normStatus(status));
    }

    if (empresa) {
      query = query.where("empresa", "==", empresa);
    }

    if (searchTerm) {
      // Do not rely on `searchTokens` here. Older/imported documents may not have
      // that denormalized field and an array-contains query silently hides them.
      // Searching is an explicit user action, so scan the already-filtered query
      // and apply the same alias-aware matcher to every service.
      const snap = await query.get();
      const items = snap.docs
        .filter((docSnap) => serviceSearchMatches(docSnap.id, docSnap.data() as Record<string, unknown>, searchTerm))
        .map((docSnap: QueryDocumentSnapshot) => mapDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
        .sort(
          (a: PCMServiceListItem, b: PCMServiceListItem) =>
            (b.updatedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.createdAt ?? 0),
        )
        .slice(0, limit);

      return { items, nextCursor: null };
    }

    query = query.orderBy("updatedAt", "desc").orderBy(FieldPath.documentId(), "desc");

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) query = query.startAfter(Timestamp.fromMillis(decoded.updatedAt), decoded.id);
    }

    query = query.limit(limit);

    const snap = await query.get();
    const items = snap.docs.map((docSnap) =>
      mapDoc(docSnap.id, docSnap.data() as Record<string, unknown>),
    );
    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = last
      ? encodeCursor({ updatedAt: toTimestamp(last.get("updatedAt")) ?? 0, id: last.id })
      : null;

    return { items, nextCursor };
  } catch (error) {
    console.error("[data] listServicesPCM falhou", error);
    return { items: [], nextCursor: null };
  }
}

/** Lista pacotes com paginação para o PCM. */
function mapPackageDoc(id: string, data: Record<string, unknown>): PCMPackageListItem {
  const services = Array.isArray(data.services) ? data.services : undefined;
  const serviceIds = Array.isArray(data.serviceIds) ? data.serviceIds : undefined;
  const servicesCount = typeof data.servicesCount === "number"
    ? data.servicesCount
    : services?.length ?? serviceIds?.length ?? 0;

  return {
    id,
    name: toOptionalString(data.name) ?? toOptionalString(data.nome) ?? `Pacote ${id}`,
    status: normStatus(toOptionalString(data.status)),
    code: toOptionalString(data.code) ?? toOptionalString(data.codigo),
    createdAt:
      toTimestamp(data.createdAt ?? data.created_at ?? data.criadoEm ?? data.createdAtMs ?? data.createdAtMillis) ??
      null,
    servicesCount,
    services,
    serviceIds,
  };
}

export async function listPackagesPCM(options?: {
  limit?: number;
  cursor?: string | null;
}): Promise<PCMListResponse<PCMPackageListItem>> {
  try {
    const admin = getAdminDbOrThrow();
    const { limit = 10, cursor = null } = options ?? {};

    let query: Query = admin.collection("packages");
    query = query.orderBy("createdAt", "desc").orderBy(FieldPath.documentId(), "desc");

    if (cursor) {
      const decoded = decodeCursor(cursor);
      if (decoded) query = query.startAfter(Timestamp.fromMillis(decoded.updatedAt), decoded.id);
    }

    query = query.limit(limit);

    const snap = await query.get();
    const items = snap.docs.map((docSnap) =>
      mapPackageDoc(docSnap.id, (docSnap.data() ?? {}) as Record<string, unknown>),
    );
    const last = snap.docs[snap.docs.length - 1];
    const nextCursor = last
      ? encodeCursor({ updatedAt: toTimestamp(last.get("createdAt")) ?? 0, id: last.id })
      : null;

    return { items, nextCursor };
  } catch (error) {
    console.error("[data] listPackagesPCM falhou", error);
    return { items: [], nextCursor: null };
  }
}

/** Lista serviços vinculados a um token do Terceiro, tolerante a índices. */
export async function listServicesForToken(tokenDoc: unknown, options?: { limit?: number }) {
  if (!tokenDoc || typeof tokenDoc !== "object") return [];
  const record = tokenDoc as Record<string, unknown>;
  const admin = getAdminDbOrThrow();
  const { limit = 50 } = options ?? {};

  // Caso 1: token de serviço único
  const serviceId = toOptionalString(record.serviceId);
  if (serviceId) {
    const doc = await admin.collection("services").doc(serviceId).get();
    if (!doc.exists) return [];
    return [mapDoc(doc.id, doc.data() as Record<string, unknown>)].filter(
      (s) => s.status === "Aberto" || s.status === "Pendente",
    );
  }

  // Caso 2: token de pacote + empresa
  // Estratégia sem índice composto: buscar por packageId + empresa (se falhar, buscar apenas por packageId e filtrar em memória).
  const packageId = toOptionalString(record.packageId);
  const empresa = toOptionalString(record.empresa);
  if (packageId && empresa) {
    try {
      // Caso o Firestore solicite um índice composto (packageId + empresa), siga o link exibido no console e registre-o em firestore.indexes.json.
      const q = await admin
        .collection("services")
        .where("packageId", "==", packageId)
        .where("empresa", "==", empresa)
        .limit(limit)
        .get();
      return q.docs
        .map((docSnap) => mapDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
        .filter((s) => s.status === "Aberto" || s.status === "Pendente");
    } catch {
      const q2 = await admin
        .collection("services")
        .where("packageId", "==", packageId)
        .limit(limit)
        .get();
      return q2.docs
        .map((docSnap) => mapDoc(docSnap.id, docSnap.data() as Record<string, unknown>))
        .filter(
          (s) =>
            s.empresa === empresa && (s.status === "Aberto" || s.status === "Pendente"),
        );
    }
  }

  return [];
}
