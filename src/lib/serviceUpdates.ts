import type { ServiceUpdate } from "@/lib/types";

import { formatDate as formatDateDisplay } from "./formatDateTime";
import { recordTelemetry } from "./telemetry";

type UpdateLike = {
  id?: string | null;
  percent?: number | null;
  manualPercent?: number | null;
  realPercentSnapshot?: number | null;
  createdAt?: number | null;
  submittedAt?: number | null;
  timeWindow?: { start?: number | null; end?: number | null } | null;
  mode?: string | null;
  token?: string | null;
  audit?: {
    submittedBy?: string | null;
    submittedByType?: string | null;
    token?: string | null;
  } | null;
};

type WithDescription = {
  description?: string | null;
};

type WithResources = {
  resources?: Array<{ name: string; quantity?: number | null; unit?: string | null }> | null;
};

type NormalisedUpdate<T> = T & { percent: number };

const MINUTE_IN_MS = 60_000;

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 100) return 100;
  return value;
}

function resolvePercent(update: UpdateLike): number {
  const candidates = [update.percent, update.manualPercent, update.realPercentSnapshot];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return clampPercent(candidate);
    }
  }
  return 0;
}

function safeString(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function normaliseTimestampBucket(update: UpdateLike): number {
  const sources = [update.createdAt, update.timeWindow?.start, update.timeWindow?.end];
  for (const source of sources) {
    if (typeof source === "number" && Number.isFinite(source)) {
      return Math.floor(source / MINUTE_IN_MS);
    }
  }
  return 0;
}

function resolveAuthor(update: UpdateLike): string {
  const audit = update.audit ?? undefined;
  const candidates = [audit?.submittedBy, audit?.token, update.token];
  for (const candidate of candidates) {
    const value = safeString(candidate ?? undefined);
    if (value) return value.toLowerCase();
  }
  return "anonimo";
}

function resolveMode(update: UpdateLike): string {
  const raw = safeString(update.mode ?? undefined);
  if (raw === "detailed" || raw === "simple") {
    return raw;
  }
  const auditType = safeString(update.audit?.submittedByType ?? undefined);
  if (auditType) return auditType.toLowerCase();
  return "manual";
}

function sanitiseKeyPart(part: string): string {
  return part.replace(/[^a-z0-9_-]/gi, "_");
}

export function buildStableUpdateKey(update: UpdateLike & WithDescription): string {
  if (update.id) {
    return `id:${update.id}`;
  }

  const bucket = normaliseTimestampBucket(update);
  const author = resolveAuthor(update);
  const mode = resolveMode(update);
  const percent = resolvePercent(update);
  const description = safeString(update.description)?.toLowerCase() ?? "sem-descricao";

  const parts = [
    "fallback",
    sanitiseKeyPart(mode),
    sanitiseKeyPart(author),
    String(bucket),
    percent.toFixed(1),
    sanitiseKeyPart(description.slice(0, 24)),
  ];

  return parts.join(":");
}

function mergeUpdates<T extends UpdateLike & WithDescription>(current: NormalisedUpdate<T>, next: NormalisedUpdate<T>): NormalisedUpdate<T> {
  const currentHasId = Boolean(current.id && !String(current.id).startsWith("local-"));
  const nextHasId = Boolean(next.id && !String(next.id).startsWith("local-"));

  if (nextHasId && !currentHasId) {
    return { ...current, ...next };
  }
  if (!nextHasId && currentHasId) {
    return { ...next, ...current };
  }

  const currentCreatedAt = typeof current.createdAt === "number" ? current.createdAt : 0;
  const nextCreatedAt = typeof next.createdAt === "number" ? next.createdAt : 0;

  if (nextCreatedAt > currentCreatedAt) {
    return { ...current, ...next };
  }
  if (currentCreatedAt > nextCreatedAt) {
    return { ...next, ...current };
  }
  return { ...current, ...next };
}

export function dedupeUpdates<T extends UpdateLike & WithDescription>(updates: T[]): NormalisedUpdate<T>[] {
  const map = new Map<string, NormalisedUpdate<T>>();
  let duplicates = 0;

  updates.forEach((update) => {
    const normalisedPercent = resolvePercent(update);
    const withPercent = { ...update, percent: normalisedPercent } as NormalisedUpdate<T>;
    const key = buildStableUpdateKey(update);
    const existing = map.get(key);
    if (existing) {
      duplicates += 1;
      map.set(key, mergeUpdates(existing, withPercent));
    } else {
      map.set(key, withPercent);
    }
  });

  if (duplicates > 0) {
    recordTelemetry("updates.deduplicated", { duplicates, total: map.size });
  }

  return Array.from(map.values()).sort((a, b) => {
    const left =
      typeof a.submittedAt === "number"
        ? a.submittedAt
        : typeof a.createdAt === "number"
          ? a.createdAt
          : 0;
    const right =
      typeof b.submittedAt === "number"
        ? b.submittedAt
        : typeof b.createdAt === "number"
          ? b.createdAt
          : 0;
    return right - left;
  });
}

export function mergeAndDedupeUpdates<T extends UpdateLike & WithDescription>(
  previous: T[],
  incoming: T[],
): NormalisedUpdate<T>[] {
  return dedupeUpdates([...incoming, ...previous]);
}

export function sanitiseResourceQuantities<T extends WithResources>(update: T): T {
  if (!Array.isArray(update.resources)) {
    return update;
  }

  const resources = update.resources.map((resource) => {
    if (typeof resource.quantity === "number" && resource.quantity <= 0) {
      return { ...resource, quantity: null };
    }
    return resource;
  });

  return { ...update, resources };
}

export function formatResourcesLine(resources: Array<{ name: string; quantity?: number | null; unit?: string | null }>): string {
  if (!resources.length) return "";
  const entries = resources.map((item) => {
    const hasQuantity = typeof item.quantity === "number" && item.quantity > 0;
    if (!hasQuantity) return item.name;
    const quantity = Number(item.quantity).toLocaleString("pt-BR");
    const unit = item.unit ? ` ${item.unit}` : "";
    return `${item.name} • ${quantity}${unit}`;
  });
  return entries.join(", ");
}

export type FormattedUpdateSummary = {
  title: string;
  percentLabel: string;
  description?: string;
  resources?: string;
  hoursLabel?: string;
};

/**
 * Formata o percentual consolidado usado nas visões resumidas.
 *
 * O último lançamento fornece data e descrição, mas seu snapshot pode ser uma
 * cópia legada (inclusive de um lançamento já excluído). Por isso a porcentagem
 * visível deve vir do progresso canônico usado pelos cálculos e gráficos.
 */
export function formatCanonicalProgressLabel(progress: number | null | undefined): string {
  const numeric = typeof progress === "number" && Number.isFinite(progress) ? progress : 0;
  return `${Math.round(clampPercent(numeric))}%`;
}

function formatDateLabel(timestamp: number | null | undefined): string {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return "-";
  }
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "-";
  return formatDateDisplay(date, { timeZone: "America/Sao_Paulo", fallback: "-" }) || "-";
}

function computeHoursFromWindow(update: UpdateLike & { timeWindow?: { start?: number | null; end?: number | null; hours?: number | null } | null }): number | null {
  const hours = update.timeWindow?.hours;
  if (typeof hours === "number" && Number.isFinite(hours)) {
    return Math.round(hours * 100) / 100;
  }
  const start = update.timeWindow?.start;
  const end = update.timeWindow?.end;
  if (typeof start === "number" && typeof end === "number" && Number.isFinite(start) && Number.isFinite(end)) {
    const diff = (end - start) / 3_600_000;
    if (diff >= 0 && Number.isFinite(diff)) {
      return Math.round(diff * 100) / 100;
    }
  }
  return null;
}

export function formatUpdateSummary(update: ServiceUpdate): FormattedUpdateSummary {
  const title = formatDateLabel(update.timeWindow?.start ?? update.createdAt ?? null);
  const percentLabel = `${Math.round(update.percent ?? 0)}%`;
  const description = update.description ? `Descrição do dia: ${update.description}` : undefined;

  const hours = computeHoursFromWindow(update);
  const hoursLabel = hours !== null && Math.abs(hours - 24) > 0.01 ? `Horas informadas: ${hours.toFixed(2)}` : undefined;

  const resourcesLabel = Array.isArray(update.resources) && update.resources.length > 0
    ? formatResourcesLine(update.resources)
    : undefined;

  return {
    title,
    percentLabel,
    description,
    resources: resourcesLabel,
    hoursLabel,
  };
}
