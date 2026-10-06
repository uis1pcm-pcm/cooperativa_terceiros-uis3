import { getAdminDbOrThrow } from "@/lib/serverDb";
import type { ThirdChecklistItem, ThirdService, ThirdServiceUpdate } from "@/app/(third)/terceiro/servico/[id]/types";

type FirestoreDateLike = {
  toMillis?: () => number;
  toDate?: () => Date;
  seconds?: number;
  nanoseconds?: number;
} | null;

function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getTime();
    return null;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "object" && value) {
    const maybe = value as FirestoreDateLike;
    if (maybe?.toMillis) {
      const millis = maybe.toMillis();
      if (typeof millis === "number" && Number.isFinite(millis)) return millis;
    }
    if (maybe?.toDate) {
      const date = maybe.toDate();
      if (date && !Number.isNaN(date.getTime())) return date.getTime();
    }
    if (typeof maybe?.seconds === "number") {
      const millis = maybe.seconds * 1000 + Math.round((maybe.nanoseconds ?? 0) / 1_000_000);
      if (Number.isFinite(millis)) return millis;
    }
  }
  return null;
}

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toOptionalString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function clampPercent(value: number | null): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.min(100, Math.max(0, Number(value)));
}

function pickDateFieldMillis(data: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    if (!(key in data)) continue;
    const millis = toMillis(data[key]);
    if (millis !== null) return millis;
  }
  return null;
}

function normaliseChecklistStatus(value: unknown): ThirdChecklistItem["status"] {
  const raw = String(value ?? "").trim().toLowerCase().replace(/_/g, "-");
  if (raw.includes("conclu")) return "concluido";
  if (raw.includes("andamento")) return "em-andamento";
  return "nao-iniciado";
}

export function mapThirdService(id: string, data: Record<string, unknown>): ThirdService {
  const plannedStart = pickDateFieldMillis(data, [
    "plannedStart",
    "inicioPrevisto",
    "inicioPlanejado",
    "dataInicio",
    "startDate",
  ]);
  const plannedEnd = pickDateFieldMillis(data, [
    "plannedEnd",
    "fimPrevisto",
    "fimPlanejado",
    "dataFim",
    "endDate",
  ]);
  const totalHours =
    toFiniteNumber(
      data.totalHours ??
        data.totalHoras ??
        data.horasTotais ??
        data.horasPrevistas ??
        data.hours ??
        data.horas,
    ) ?? null;
  const realPercent =
    toFiniteNumber(
      data.andamento ??
        data.percentualRealAtual ??
        data.realPercentSnapshot ??
        data.realPercent ??
        data.real_percent ??
        data.progress,
    ) ?? null;
  const manualPercent = toFiniteNumber(data.manualPercent ?? data.manual_percent) ?? null;
  const andamento = toFiniteNumber(data.andamento ?? data.progress) ?? null;

  const companyCandidates = [
    data.company,
    data.companyId,
    data.company_id,
    data.empresa,
    data.empresaId,
    data.empresa_id,
  ];
  const company = companyCandidates.map(toOptionalString).find((value) => value) ?? null;

  const os = toOptionalString(data.os ?? (data as Record<string, unknown>).OS ?? data.serviceNumber);
  const oc = toOptionalString(data.oc ?? data.ordemCompra);
  const code = toOptionalString(data.code ?? data.codigo ?? data.serviceCode);
  const tag = toOptionalString(data.tag);
  const equipmentName = toOptionalString(data.equipmentName ?? data.equipamento ?? data.equipment);
  const sector = toOptionalString(data.sector ?? data.setor ?? data.sectorName);
  const status = toOptionalString(data.status);
  const cnpj = toOptionalString(data.cnpj);

  return {
    id,
    os,
    oc,
    code,
    tag,
    equipmentName,
    sector,
    status,
    plannedStart,
    plannedEnd,
    totalHours,
    company,
    cnpj,
    andamento,
    realPercent,
    manualPercent,
    previousProgress: toFiniteNumber(data.previousProgress ?? data.progressBeforeConclusion ?? data.previousPercent) ?? null,
    updatedAt: toMillis(data.updatedAt ?? data.lastUpdate ?? data.modifiedAt),
    hasChecklist:
      data.hasChecklist === true || Array.isArray(data.checklist) || Array.isArray(data.checklists),
  };
}

export function mapThirdUpdate(id: string, data: Record<string, unknown>): ThirdServiceUpdate {
  const percentCandidate =
    toFiniteNumber(data.manualPercent ?? data.manual_percent) ??
    toFiniteNumber(
      data.realPercentSnapshot ?? data.real_percent_snapshot ?? data.realPercent ?? data.percent ?? data.progress,
    ) ??
    0;

  const description = toOptionalString(data.note ?? data.description ?? data.text) ?? undefined;
  const auditSubmittedAt = toMillis((data.audit as Record<string, unknown> | undefined)?.submittedAt);
  const submittedAt =
    auditSubmittedAt ?? toMillis((data as Record<string, unknown>).submittedAt) ?? toMillis(data.createdAt);

  return {
    id,
    percent: clampPercent(percentCandidate),
    description,
    createdAt: toMillis(data.createdAt) ?? submittedAt ?? null,
    submittedAt,
    audit: auditSubmittedAt ? { submittedAt: auditSubmittedAt } : undefined,
    timeWindow: (() => {
      const raw = data.timeWindow ?? data.period;
      if (!raw || typeof raw !== "object") return undefined;
      const record = raw as Record<string, unknown>;
      const start = toMillis(record.start);
      const end = toMillis(record.end);
      const hours = toFiniteNumber(record.hours);
      if (!start && !end && !hours) return undefined;
      return {
        start,
        end,
        hours: hours ?? (start && end ? (end - start) / 3_600_000 : null),
      };
    })(),
    subactivity: (() => {
      const raw = data.subactivity ?? data.etapa;
      if (!raw || typeof raw !== "object") return undefined;
      const record = raw as Record<string, unknown>;
      const idValue = toOptionalString(record.id);
      const labelValue = toOptionalString(record.label ?? record.name ?? record.descricao);
      if (!idValue && !labelValue) return undefined;
      return { id: idValue ?? undefined, label: labelValue ?? undefined };
    })(),
    mode: (() => {
      const raw = toOptionalString(data.mode);
      if (raw === "detailed" || raw === "simple") return raw;
      return undefined;
    })(),
    impediments: Array.isArray(data.impediments)
      ? (data.impediments as Array<Record<string, unknown>>)
          .map((item) => {
            const type = toOptionalString(item.type ?? item.description);
            if (!type) return null;
            const duration = toFiniteNumber(item.durationHours ?? item.duration ?? item.horas);
            return { type, durationHours: duration ?? null };
          })
          .filter(Boolean) as Array<{ type: string; durationHours?: number | null }>
      : undefined,
    resources: Array.isArray(data.resources)
      ? (data.resources as Array<Record<string, unknown>>)
          .map((item) => {
            const name = toOptionalString(item.name ?? item.recurso);
            if (!name) return null;
            const quantity = toFiniteNumber(item.quantity ?? item.qty ?? item.quantidade);
            const unit = toOptionalString(item.unit ?? item.unidade);
            return {
              name,
              quantity: quantity && quantity > 0 ? quantity : null,
              unit: unit ?? undefined,
            };
          })
          .filter(Boolean) as Array<{ name: string; quantity?: number | null; unit?: string | null }>
      : undefined,
    forecastDate: toMillis(data.forecastDate ?? data.previsao),
    criticality: toFiniteNumber(data.criticality ?? data.criticidade) ?? null,
    evidences: Array.isArray(data.evidences)
      ? (data.evidences as Array<Record<string, unknown>>)
          .map((item) => {
            const url = toOptionalString(item.url ?? item.link);
            if (!url) return null;
            const label = toOptionalString(item.label ?? item.description ?? item.nome);
            return { url, label: label ?? undefined };
          })
          .filter(Boolean) as Array<{ url: string; label?: string | null }>
      : undefined,
    justification: toOptionalString(data.justification ?? data.reason) ?? null,
    previousPercent: toFiniteNumber(data.previousPercent ?? data.percentBefore ?? data.previous) ?? null,
    declarationAccepted: typeof data.declarationAccepted === "boolean" ? data.declarationAccepted : undefined,
  };
}

export function mapThirdChecklistItem(data: Record<string, unknown>): ThirdChecklistItem {
  return {
    id: String(data.id ?? data.itemId ?? data.checklistId ?? crypto.randomUUID()),
    description: toOptionalString(data.description ?? data.descricao) ?? "Item do checklist",
    weight: toFiniteNumber(data.weight ?? data.peso) ?? 0,
    progress: clampPercent(toFiniteNumber(data.progress ?? data.percentual ?? data.pct) ?? 0),
    status: normaliseChecklistStatus(data.status),
    updatedAt: toMillis(data.updatedAt),
  };
}

export async function fetchThirdService(serviceId: string): Promise<ThirdService | null> {
  const adminDb = getAdminDbOrThrow();
  const snap = await adminDb.collection("services").doc(serviceId).get();
  if (!snap.exists) return null;
  return mapThirdService(snap.id, (snap.data() ?? {}) as Record<string, unknown>);
}

export async function fetchThirdServiceUpdates(serviceId: string, limitCount: number): Promise<ThirdServiceUpdate[]> {
  const adminDb = getAdminDbOrThrow();
  const col = adminDb.collection("services").doc(serviceId).collection("updates");
  const snap = await col.orderBy("audit.submittedAt", "desc").limit(limitCount).get();
  return snap.docs.map((doc) => mapThirdUpdate(doc.id, (doc.data() ?? {}) as Record<string, unknown>));
}

function mapChecklistArray(raw: unknown): ThirdChecklistItem[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw
    .map((item, index) => {
      if (typeof item !== "object" || item === null) return null;
      const record = item as Record<string, unknown>;
      const payload: Record<string, unknown> = { ...record };
      if (typeof payload.id !== "string" || !payload.id) {
        const fallbackId =
          (typeof record.id === "string" && record.id) ||
          (typeof record.itemId === "string" && record.itemId) ||
          `item-${index}`;
        payload.id = fallbackId;
      }
      return mapThirdChecklistItem(payload);
    })
    .filter((entry): entry is ThirdChecklistItem => Boolean(entry));
}

async function fetchChecklistFromDocument(serviceId: string): Promise<ThirdChecklistItem[]> {
  try {
    const adminDb = getAdminDbOrThrow();
    const snap = await adminDb.collection("services").doc(serviceId).get();
    if (!snap.exists) return [];
    const data = (snap.data() ?? {}) as Record<string, unknown>;
    return mapChecklistArray(data.checklist ?? data.checklists ?? data.items);
  } catch (error) {
    console.warn(`[thirdServiceData] Falha ao carregar checklist embutido de ${serviceId}`, error);
    return [];
  }
}

export async function fetchThirdServiceChecklist(serviceId: string): Promise<ThirdChecklistItem[]> {
  const adminDb = getAdminDbOrThrow();
  const col = adminDb.collection("services").doc(serviceId).collection("checklist");
  const snap = await col.orderBy("description", "asc").get();
  const items = snap.docs.map((doc) =>
    mapThirdChecklistItem({ id: doc.id, ...(doc.data() ?? {}) } as Record<string, unknown>),
  );
  if (items.length > 0) {
    return items;
  }
  return fetchChecklistFromDocument(serviceId);
}
