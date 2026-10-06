import { realizedFromChecklist, realizedFromUpdates } from "@/lib/curve";
import { dedupeUpdates, formatUpdateSummary, sanitiseResourceQuantities } from "@/lib/serviceUpdates";
import {
  formatDate as formatDateDisplay,
  formatDateTime as formatDateTimeDisplay,
  formatDayKey,
} from "@/lib/formatDateTime";
import { parseDayFirstDateStringToUtcDate, parsePortugueseDateStringToUtcDate } from "@/lib/dateParsing";
import type {
  ChecklistItem,
  Service,
  ServiceUpdate,
} from "@/lib/types";
import type {
  DocumentData,
  DocumentSnapshot,
  QueryDocumentSnapshot,
} from "firebase/firestore";

export type ServiceRealtimeData = {
  id: string;
  os?: string | null;
  code?: string | null;
  oc?: string | null;
  tag?: string | null;
  equipmentName?: string | null;
  sector?: string | null;
  setor?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  totalHours?: number | null;
  status?: string | null;
  andamento?: number | null;
  realPercent?: number | null;
  realPercentSnapshot?: number | null;
  manualPercent?: number | null;
  progress?: number | null;
  assignedTo?: { companyId?: string; companyName?: string } | null;
  company?: string | null;
  empresa?: string | null;
  cnpj?: string | null;
  createdAt?: number | null;
  updatedAt?: number | null;
  hasChecklist?: boolean | null;
  previousProgress?: number | null;
  description?: string | null;
};

type PlannedPoint = { date: string; percent: number; hoursAccum?: number };

type FirestoreLikeTimestamp = { toMillis?: () => number } | { seconds?: number; nanoseconds?: number };

type ServiceRecord = Record<string, unknown>;

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

type FirestoreAudit = {
  submittedBy?: string | null;
  submittedByType?: "token" | "user" | "system" | string | null;
  submittedAt?: unknown;
  previousPercent?: unknown;
  newPercent?: unknown;
  token?: unknown;
  ip?: unknown;
};

export function toMillis(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const brDate = parseDayFirstDateStringToUtcDate(value);
    if (brDate) return brDate.getTime();

    const ptDate = parsePortugueseDateStringToUtcDate(value);
    if (ptDate) return ptDate.getTime();

    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date.getTime();
    }
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "object") {
    const maybe = value as FirestoreLikeTimestamp & { toDate?: () => Date };
    if (typeof maybe?.toMillis === "function") {
      const millis = maybe.toMillis();
      if (typeof millis === "number" && Number.isFinite(millis)) {
        return millis;
      }
    }
    if (typeof maybe?.toDate === "function") {
      const date = maybe.toDate();
      if (date instanceof Date && !Number.isNaN(date.getTime())) {
        return date.getTime();
      }
    }
    if (typeof maybe?.seconds === "number") {
      const millis = maybe.seconds * 1000 + Math.round((maybe.nanoseconds ?? 0) / 1_000_000);
      if (Number.isFinite(millis)) {
        return millis;
      }
    }
  }
  return null;
}

export function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
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

function toIsoDate(value: unknown): string | null {
  const millis = toMillis(value);
  if (millis === null) return null;
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function pickDateField(data: ServiceRecord, keys: string[]): string | null {
  for (const key of keys) {
    if (!(key in data)) continue;
    const iso = toIsoDate(data[key]);
    if (iso) return iso;
  }
  return null;
}

export function composeServiceRealtimeData(
  primary: Partial<Service> | null | undefined,
  fallback?: Partial<Service> | null,
): ServiceRealtimeData {
  const base: ServiceRealtimeData = {
    id: String(primary?.id ?? fallback?.id ?? ""),
    os: primary?.os ?? fallback?.os ?? null,
    code: primary?.code ?? fallback?.code ?? null,
    oc: primary?.oc ?? fallback?.oc ?? null,
    tag: primary?.tag ?? fallback?.tag ?? null,
    equipmentName: primary?.equipmentName ?? fallback?.equipmentName ?? null,
    sector: primary?.sector ?? fallback?.sector ?? null,
    setor: primary?.setor ?? fallback?.setor ?? null,
    // Alguns documentos canônicos antigos possuem a chave, mas com string
    // vazia. Nesse caso não devemos ocultar as datas válidas do fallback.
    plannedStart: primary?.plannedStart?.trim() || fallback?.plannedStart?.trim() || null,
    plannedEnd: primary?.plannedEnd?.trim() || fallback?.plannedEnd?.trim() || null,
    totalHours:
      typeof primary?.totalHours === "number"
        ? primary?.totalHours
        : typeof fallback?.totalHours === "number"
          ? fallback.totalHours
          : null,
    status: primary?.status ?? fallback?.status ?? null,
    andamento: primary?.andamento ?? fallback?.andamento ?? null,
    realPercent: primary?.realPercent ?? fallback?.realPercent ?? null,
    realPercentSnapshot: primary?.realPercentSnapshot ?? fallback?.realPercentSnapshot ?? null,
    manualPercent: primary?.manualPercent ?? fallback?.manualPercent ?? null,
    progress: primary?.progress ?? fallback?.progress ?? null,
    assignedTo: primary?.assignedTo ?? fallback?.assignedTo ?? null,
    company: primary?.company ?? fallback?.company ?? null,
    empresa: primary?.empresa ?? fallback?.empresa ?? null,
    cnpj: primary?.cnpj ?? fallback?.cnpj ?? null,
    createdAt: primary?.createdAt ?? fallback?.createdAt ?? null,
    updatedAt: primary?.updatedAt ?? fallback?.updatedAt ?? null,
    hasChecklist: primary?.hasChecklist ?? fallback?.hasChecklist ?? null,
    previousProgress: primary?.previousProgress ?? fallback?.previousProgress ?? null,
    description: primary?.description ?? fallback?.description ?? null,
  };

  if (!base.plannedStart && typeof primary?.createdAt === "number") {
    base.plannedStart = new Date(primary.createdAt).toISOString();
  }

  return base;
}

export function mergeServiceRealtime(
  current: ServiceRealtimeData,
  next: Partial<ServiceRealtimeData>,
): ServiceRealtimeData {
  return {
    ...current,
    ...next,
    assignedTo: next.assignedTo ?? current.assignedTo ?? null,
  };
}

export function mapServiceSnapshot(
  snapshot: DocumentSnapshot<DocumentData>,
): Partial<ServiceRealtimeData> {
  if (!snapshot.exists()) return {};
  const data = (snapshot.data() ?? {}) as ServiceRecord;
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

  const assignedRaw = data.assignedTo;
  const assignedTo =
    assignedRaw && typeof assignedRaw === "object"
      ? {
          companyId: toOptionalString((assignedRaw as ServiceRecord).companyId ?? (assignedRaw as ServiceRecord).empresaId) ?? undefined,
          companyName: toOptionalString((assignedRaw as ServiceRecord).companyName ?? (assignedRaw as ServiceRecord).empresaNome) ?? undefined,
        }
      : null;

  const companyCandidates = [
    data.company,
    data.companyId,
    data.empresa,
    data.empresaId,
  ];
  const company = companyCandidates.map(toOptionalString).find((value) => value) ?? null;

  return {
    id: snapshot.id,
    os: toOptionalString(data.os) ?? null,
    code: toOptionalString(data.code) ?? null,
    oc: toOptionalString(data.oc) ?? null,
    tag: toOptionalString(data.tag) ?? null,
    equipmentName:
      toOptionalString(data.equipmentName ?? data.equipamento ?? data.equipment) ?? null,
    sector: toOptionalString(data.sector) ?? null,
    setor: toOptionalString(data.setor) ?? null,
    plannedStart,
    plannedEnd,
    totalHours:
      toNumber(
        data.totalHours ?? data.totalHoras ?? data.horasTotais ?? data.horasPrevistas ?? data.hours,
      ) ?? null,
    status: toOptionalString(data.status) ?? null,
    andamento: toNumber(data.andamento ?? data.progress) ?? null,
    realPercent: toNumber(data.realPercent) ?? null,
    realPercentSnapshot: toNumber(data.realPercentSnapshot) ?? null,
    manualPercent: toNumber(data.manualPercent) ?? null,
    progress: toNumber(data.progress) ?? null,
    assignedTo,
    company,
    empresa: toOptionalString(data.empresa) ?? null,
    cnpj: toOptionalString(data.cnpj) ?? null,
    createdAt: toMillis(data.createdAt) ?? null,
    updatedAt: toMillis(data.updatedAt) ?? null,
    hasChecklist: data.hasChecklist === true || Array.isArray(data.checklist) ? true : null,
    previousProgress: toNumber(data.previousProgress) ?? null,
    description: toOptionalString(data.description ?? data.descricao) ?? null,
  };
}

function mapChecklistStatus(value: unknown): ChecklistItem["status"] {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
  if (raw === "concluido" || raw === "concluído") return "concluido";
  if (raw === "em-andamento" || raw === "andamento") return "em-andamento";
  return "nao-iniciado";
}

export function mapChecklistSnapshot(
  doc: QueryDocumentSnapshot<DocumentData>,
): ChecklistItem {
  const data = (doc.data() ?? {}) as ServiceRecord;
  return {
    id: String(data.id ?? data.itemId ?? doc.id),
    description: String(data.description ?? data.descricao ?? ""),
    weight: toNumber(data.weight ?? data.peso) ?? 0,
    progress: toNumber(data.progress ?? data.percentual ?? data.pct) ?? 0,
    status: mapChecklistStatus(data.status),
    serviceId: String(data.serviceId ?? doc.ref.parent.parent?.id ?? ""),
    updatedAt: toMillis(data.updatedAt) ?? undefined,
  };
}

function mapTimeWindow(raw: unknown): ServiceUpdate["timeWindow"] {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as ServiceRecord;
  const start = toMillis(record.start);
  const end = toMillis(record.end);
  const hours = toNumber(record.hours);
  if (start === null && end === null && hours === null) return undefined;
  return {
    start: start ?? undefined,
    end: end ?? undefined,
    hours: hours ?? undefined,
  };
}

function mapSubactivity(raw: unknown): ServiceUpdate["subactivity"] {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as ServiceRecord;
  const id = toOptionalString(record.id);
  const label = toOptionalString(record.label ?? record.name ?? record.descricao);
  if (!id && !label) return undefined;
  return { id: id ?? undefined, label: label ?? undefined };
}

function mapImpediments(raw: unknown): ServiceUpdate["impediments"] {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as ServiceRecord;
      const type = toOptionalString(record.type ?? record.description);
      if (!type) return null;
      const duration = toNumber(record.durationHours ?? record.duration ?? record.horas);
      return { type, durationHours: duration ?? null };
    })
    .filter(Boolean);
  return items.length ? (items as Array<{ type: string; durationHours?: number | null }>) : undefined;
}

function mapResources(raw: unknown): ServiceUpdate["resources"] {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as ServiceRecord;
      const name = toOptionalString(record.name ?? record.recurso ?? record.descricao);
      if (!name) return null;
      const quantity = toNumber(record.quantity ?? record.quantidade);
      const unit = toOptionalString(record.unit ?? record.unidade);
      return {
        name,
        quantity: quantity ?? null,
        unit: unit ?? null,
      };
    })
    .filter(Boolean);
  return items.length ? (items as Array<{ name: string; quantity?: number | null; unit?: string | null }>) : undefined;
}

function mapWorkforce(raw: unknown): ServiceUpdate["workforce"] {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as ServiceRecord;
      const role = toOptionalString(record.role ?? record.funcao ?? record.tipo);
      if (!role) return null;
      const quantity = toNumber(record.quantity ?? record.quantidade ?? record.qtd);
      if (!Number.isFinite(quantity ?? NaN)) return null;
      return {
        role,
        quantity: Math.max(1, Math.round(Number(quantity))),
      };
    })
    .filter(Boolean);
  return items.length ? (items as Array<{ role: string; quantity: number }>) : undefined;
}

function mapShiftConditions(raw: unknown): ServiceUpdate["shiftConditions"] {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as ServiceRecord;
      const shift = toOptionalString(record.shift ?? record.turno)?.toLowerCase();
      const weather = toOptionalString(record.weather ?? record.clima)?.toLowerCase();
      const condition = toOptionalString(record.condition ?? record.condicao)?.toLowerCase();
      if (!shift || !weather || !condition) return null;
      return { shift: shift as "manha" | "tarde" | "noite", weather: weather as "claro" | "nublado" | "chuvoso", condition: condition as "praticavel" | "impraticavel" };
    })
    .filter(Boolean);
  return items.length
    ? (items as Array<{ shift: "manha" | "tarde" | "noite"; weather: "claro" | "nublado" | "chuvoso"; condition: "praticavel" | "impraticavel" }> )
    : undefined;
}

function mapEvidences(raw: unknown): ServiceUpdate["evidences"] {
  if (!Array.isArray(raw)) return undefined;
  const items = raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as ServiceRecord;
      const url = toOptionalString(record.url ?? record.link);
      if (!url) return null;
      const label = toOptionalString(record.label ?? record.nome ?? record.descricao);
      return { url, label };
    })
    .filter(Boolean);
  return items.length ? (items as Array<{ url: string; label?: string | null }>) : undefined;
}

function mapAudit(raw: unknown): ServiceUpdate["audit"] {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as FirestoreAudit;
  const submittedByType = (() => {
    if (typeof record.submittedByType !== "string") return undefined;
    const normalized = record.submittedByType.trim().toLowerCase();
    if (normalized === "token" || normalized === "user" || normalized === "system") {
      return normalized as "token" | "user" | "system";
    }
    return undefined;
  })();

  return {
    submittedBy: toOptionalString(record.submittedBy) ?? null,
    submittedByType,
    submittedAt: toMillis(record.submittedAt) ?? null,
    previousPercent: toNumber(record.previousPercent) ?? null,
    newPercent: toNumber(record.newPercent) ?? null,
    token: toOptionalString(record.token) ?? null,
    ip: toOptionalString(record.ip) ?? null,
  };
}

export function mapUpdateSnapshot(
  doc: QueryDocumentSnapshot<DocumentData>,
): ServiceUpdate {
  const data = (doc.data() ?? {}) as ServiceRecord;
  const manualPercent = toNumber(data.manualPercent) ?? undefined;
  const realPercent = toNumber(data.realPercentSnapshot ?? data.realPercent ?? data.percent) ?? manualPercent ?? 0;
  const description = (() => {
    const raw = data.description ?? data.note ?? data.observacao;
    if (typeof raw === "string") {
      const trimmed = raw.trim();
      return trimmed.length ? trimmed : "";
    }
    return "";
  })();

  const auditSubmittedAt =
    typeof data.audit === "object" && data.audit !== null
      ? toMillis((data.audit as ServiceRecord).submittedAt)
      : null;
  const submittedAt = auditSubmittedAt ?? toMillis(data.submittedAt);
  // Priorizar o campo 'date' (reportDate) que é a data informada pelo terceiro
  const reportDate = toMillis(data.date ?? data.reportDate);
  const createdAt = toMillis(data.createdAt) ?? submittedAt ?? reportDate ?? 0;

  return {
    id: doc.id,
    serviceId: doc.ref.parent.parent?.id,
    token: toOptionalString(data.token) ?? undefined,
    manualPercent,
    realPercentSnapshot: realPercent,
    percent: realPercent,
    description,
    timeWindow: mapTimeWindow(data.timeWindow ?? data.periodo),
    subactivity: mapSubactivity(data.subactivity ?? data.etapa),
    mode:
      typeof data.mode === "string" && (data.mode === "detailed" || data.mode === "simple")
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
      typeof data.justification === "string" ? data.justification.trim() || null : null,
    previousPercent: toNumber(data.previousPercent) ?? null,
    declarationAccepted:
      typeof data.declarationAccepted === "boolean" ? data.declarationAccepted : undefined,
    audit: mapAudit(data.audit),
    submittedAt: submittedAt ?? undefined,
    date: reportDate ?? null,
    createdAt,
  };
}

export function normaliseStatus(value: unknown): "Aberto" | "Pendente" | "Concluído" {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "concluido" || raw === "concluído" || raw === "encerrado") return "Concluído";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

export function formatDate(value?: number | string | Date | null): string {
  if (value === null || value === undefined) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDateDisplay(date, { timeZone: DEFAULT_TIME_ZONE, fallback: "-" }) || "-";
}

export function formatDateTime(value?: number | string | Date | null): string {
  if (value === null || value === undefined) return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDateTimeDisplay(date, { timeZone: DEFAULT_TIME_ZONE, fallback: "-" }) || "-";
}

export function resolveUpdateTimestamp(update: ServiceUpdate): number | null {
  return update.audit?.submittedAt ?? update.submittedAt ?? update.createdAt ?? null;
}

function toDayIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  const millis = toMillis(value);
  if (millis === null) return null;
  const formatted = formatDayKey(millis, { timeZone: DEFAULT_TIME_ZONE, fallback: "" });
  return formatted || null;
}

export function computeTimeWindowHours(update: ServiceUpdate): number | null {
  const raw = update.timeWindow?.hours;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100) / 100;
    }
  }
  const start = update.timeWindow?.start;
  const end = update.timeWindow?.end;
  if (start === null || start === undefined || end === null || end === undefined) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const diff = (endDate.getTime() - startDate.getTime()) / 3_600_000;
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff * 100) / 100;
}

export function normaliseProgress(value?: number | null): number {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 0))));
}

export function toNewChecklist(items: ChecklistItem[] | null | undefined): ChecklistItem[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    const status = mapChecklistStatus(item.status);
    return {
      ...item,
      status,
      progress: normaliseProgress(item.progress),
      weight: normaliseProgress(item.weight),
    };
  });
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function hasFiniteNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function hasMeaningfulTimeWindow(update: ServiceUpdate): boolean {
  const window = update.timeWindow;
  if (!window) return false;
  return [window.start, window.end, window.hours].some(hasFiniteNumber);
}

function hasMeaningfulResources(update: ServiceUpdate): boolean {
  if (!Array.isArray(update.resources)) return false;
  return update.resources.some((resource) => hasText(resource.name) || hasFiniteNumber(resource.quantity));
}

function hasMeaningfulWorkforce(update: ServiceUpdate): boolean {
  if (!Array.isArray(update.workforce)) return false;
  return update.workforce.some(
    (entry) => hasText(entry.role) && hasFiniteNumber(entry.quantity) && Number(entry.quantity) > 0,
  );
}

function hasMeaningfulImpediment(update: ServiceUpdate): boolean {
  if (!Array.isArray(update.impediments)) return false;
  return update.impediments.some((impediment) => hasText(impediment.type) || hasFiniteNumber(impediment.durationHours));
}

function hasMeaningfulShift(update: ServiceUpdate): boolean {
  if (!Array.isArray(update.shiftConditions)) return false;
  return update.shiftConditions.length > 0;
}

function hasMeaningfulEvidence(update: ServiceUpdate): boolean {
  if (!Array.isArray(update.evidences)) return false;
  return update.evidences.some((evidence) => hasText(evidence.url) || hasText(evidence.label));
}

function hasRelevantContent(update: ServiceUpdate): boolean {
  return (
    hasText(update.description) ||
    hasText(update.justification) ||
    hasMeaningfulTimeWindow(update) ||
    hasMeaningfulResources(update) ||
    hasMeaningfulWorkforce(update) ||
    hasMeaningfulImpediment(update) ||
    hasMeaningfulShift(update) ||
    hasMeaningfulEvidence(update)
  );
}

function hasMeaningfulPercent(update: ServiceUpdate): boolean {
  const percent = hasFiniteNumber(update.percent) ? Number(update.percent) : null;
  const previousPercent = hasFiniteNumber(update.previousPercent) ? Number(update.previousPercent) : null;
  const criticality = hasFiniteNumber(update.criticality) ? Number(update.criticality) : null;

  if (criticality !== null) return true;
  if (percent !== null && percent > 0) return true;
  if (previousPercent !== null && previousPercent > 0) return true;
  if (percent !== null && previousPercent !== null && percent !== previousPercent) return true;
  return false;
}

function isMeaningfulUpdate(update: ServiceUpdate): boolean {
  return (
    hasText(update.description) ||
    hasText(update.justification) ||
    hasMeaningfulPercent(update) ||
    hasMeaningfulTimeWindow(update) ||
    hasMeaningfulResources(update) ||
    hasMeaningfulWorkforce(update) ||
    hasMeaningfulImpediment(update) ||
    hasMeaningfulShift(update) ||
    hasMeaningfulEvidence(update) ||
    hasFiniteNumber(update.forecastDate)
  );
}

export function filterUpdatesWithRelevantContent(updates: ServiceUpdate[]): ServiceUpdate[] {
  // Lançamentos sem informações relevantes (apenas data/hora/percentual) são filtrados
  // da listagem para não poluir as Atualizações recentes.
  return updates.filter(hasRelevantContent);
}

export function toNewUpdates(updates: ServiceUpdate[] | null | undefined): ServiceUpdate[] {
  if (!Array.isArray(updates)) return [];
  const normalised = updates.map((update) => sanitiseResourceQuantities(update));
  const filtered = normalised.filter(isMeaningfulUpdate);
  return dedupeUpdates(filtered);
}

export { formatUpdateSummary };

export function buildRealizedSeries(params: {
  updates: ServiceUpdate[];
  planned: PlannedPoint[];
  realizedPercent: number;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  createdAt?: number | null;
}): Array<{ date: string; percent: number }> {
  const points: Array<{ date: string; percent: number; timestamp: number }> = [];

  params.updates.forEach((update) => {
    // Regra do gráfico: usar SOMENTE o campo `date` (reportDate) informado pelo terceiro.
    // Não usar submittedAt/createdAt para posicionar o ponto no dia da curva.
    const reportDate = update.date;
    if (!reportDate) return;

    const day = toDayIso(reportDate);
    if (!day) return;
    
    // Incluir updates que tenham percentual válido (mesmo que seja 0)
    // ou que tenham realPercentSnapshot
    const percentValue =
      update.manualPercent ??
      update.percent ??
      update.realPercentSnapshot ??
      null;
    if (percentValue === null || percentValue === undefined) return;
    
    const percent = normaliseProgress(percentValue);
    if (!Number.isFinite(percent)) return;
    
    // O timestamp mantém uma ordenação determinística entre lançamentos.
    const timestamp = resolveUpdateTimestamp(update) ?? reportDate;
    points.push({ date: day, percent, timestamp });
  });

  if (points.length > 0) {
    // Ordenar por timestamp para manter ordem cronológica
    points.sort((a, b) => a.timestamp - b.timestamp);
    
    // Se houver múltiplos lançamentos no mesmo dia, manter o maior percentual.
    // O momento do envio não pode fazer um lançamento menor sobrescrever o maior avanço diário.
    const dayMap = new Map<string, { percent: number; timestamp: number }>();
    
    points.forEach((point) => {
      const existing = dayMap.get(point.date);
      if (
        !existing ||
        point.percent > existing.percent ||
        (point.percent === existing.percent && point.timestamp >= existing.timestamp)
      ) {
        dayMap.set(point.date, { percent: point.percent, timestamp: point.timestamp });
      }
    });
    
    return Array.from(dayMap.entries())
      .sort((a, b) => {
        const aTime = new Date(a[0]).getTime();
        const bTime = new Date(b[0]).getTime();
        if (Number.isNaN(aTime) || Number.isNaN(bTime)) return a[0].localeCompare(b[0]);
        return aTime - bTime;
      })
      .map(([date, data]) => ({ date, percent: data.percent }));
  }

  const plannedStart = params.plannedStart ?? params.planned[0]?.date ?? toDayIso(params.createdAt);
  const plannedEndFromData = params.plannedEnd ?? params.planned[params.planned.length - 1]?.date ?? null;

  const start = plannedStart ?? plannedEndFromData;
  const end = plannedEndFromData ?? plannedStart;

  if (!start || !end) {
    return [];
  }
  const realised = normaliseProgress(params.realizedPercent);

  if (start === end) {
    return [
      { date: start, percent: 0 },
      { date: end, percent: realised },
    ];
  }

  return [
    { date: start, percent: 0 },
    { date: end, percent: realised },
  ];
}

export function deriveRealizedPercent(
  service: ServiceRealtimeData,
  checklist: ChecklistItem[],
  updates: ServiceUpdate[],
): number {
  // Prioridade 1: realPercentSnapshot (valor mais recente lançado pelo terceiro)
  // Este é o campo que deve ser usado como fonte única de verdade
  const realPercentSnapshot = toNumber(service.realPercentSnapshot);
  if (Number.isFinite(realPercentSnapshot ?? NaN)) {
    return normaliseProgress(realPercentSnapshot ?? 0);
  }

  // Prioridade 2: manualPercent (valor digitado manualmente)
  const manualPercent = toNumber(service.manualPercent);
  if (Number.isFinite(manualPercent ?? NaN)) {
    return normaliseProgress(manualPercent ?? 0);
  }

  // Prioridade 3: realPercent (valor real calculado)
  const realPercent = toNumber(service.realPercent);
  if (Number.isFinite(realPercent ?? NaN)) {
    return normaliseProgress(realPercent ?? 0);
  }

  // Prioridade 4: outros campos de progresso
  const baselineSources = [
    service.andamento,
    service.progress,
  ];
  const baseline = baselineSources.reduce((acc, value) => {
    const numeric = toNumber(value);
    if (!Number.isFinite(numeric ?? NaN)) return acc;
    return Math.max(acc, normaliseProgress(numeric ?? 0));
  }, 0);

  // Prioridade 5: checklist calculado
  const checklistPercent = checklist.length ? realizedFromChecklist(checklist) : null;
  
  // Prioridade 6: updates mais recentes
  const updatesPercent = updates.length ? realizedFromUpdates(updates) : null;

  // Retornar o maior valor entre baseline, checklist e updates
  return Math.max(baseline, checklistPercent ?? 0, updatesPercent ?? 0);
}
