import { dateOnlyToMillis, parseDateOnly } from "@/lib/dateOnly";

function toDayMillis(value: unknown): number | null {
  if (value instanceof Date || (typeof value === "number" && Number.isFinite(value))) {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return dateOnlyToMillis({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }

  if (value && typeof value === "object") {
    const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
    const millis =
      typeof timestamp.toMillis === "function"
        ? timestamp.toMillis()
        : typeof timestamp.seconds === "number"
          ? timestamp.seconds * 1000 + (timestamp.nanoseconds ?? 0) / 1_000_000
          : null;
    if (millis !== null && Number.isFinite(millis)) return toDayMillis(millis);
  }

  if (typeof value !== "string" || !value.trim()) return null;
  const parsedDateOnly = parseDateOnly(value);
  if (parsedDateOnly) return dateOnlyToMillis(parsedDateOnly);

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return dateOnlyToMillis({
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
  });
}

function firstDate(record: Record<string, unknown>, fields: string[]): number | null {
  for (const field of fields) {
    const date = toDayMillis(record[field]);
    if (date !== null) return date;
  }
  return null;
}

export function serviceIntersectsDateRange(
  service: Record<string, unknown>,
  rangeStart: string,
  rangeEnd: string,
): boolean {
  const startBound = parseDateOnly(rangeStart);
  const endBound = parseDateOnly(rangeEnd);
  if (!startBound || !endBound) return false;

  const rangeStartMillis = dateOnlyToMillis(startBound);
  const rangeEndMillis = dateOnlyToMillis(endBound);
  if (rangeStartMillis > rangeEndMillis) return false;

  const serviceStart = firstDate(service, [
    "plannedStart",
    "inicioPrevisto",
    "dataInicio",
    "inicioPlanejado",
    "startDate",
  ]);
  const serviceEnd = firstDate(service, [
    "plannedEnd",
    "fimPrevisto",
    "dataFim",
    "fimPlanejado",
    "endDate",
  ]);

  if (serviceStart === null && serviceEnd === null) return false;
  const intervalStart = serviceStart ?? serviceEnd;
  const intervalEnd = serviceEnd ?? serviceStart;
  if (intervalStart === null || intervalEnd === null || intervalStart > intervalEnd) return false;
  return intervalStart <= rangeEndMillis && intervalEnd >= rangeStartMillis;
}
