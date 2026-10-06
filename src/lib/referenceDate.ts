export const DEFAULT_TIME_ZONE = "America/Sao_Paulo" as const;

function extractParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;

  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  const second = Number(get("second"));

  return { year, month, day, hour, minute, second };
}

export function startOfDayInTimeZone(date: Date, timeZone: string = DEFAULT_TIME_ZONE): Date {
  const utcMidday = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    12,
    0,
    0,
  );

  const { year, month, day, hour, minute, second } = extractParts(new Date(utcMidday), timeZone);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return new Date(date.getTime());
  }

  const safeHour = Number.isFinite(hour) ? hour : 0;
  const safeMinute = Number.isFinite(minute) ? minute : 0;
  const safeSecond = Number.isFinite(second) ? second : 0;

  const timezoneMiddayUtc = Date.UTC(year, month - 1, day, safeHour, safeMinute, safeSecond);
  const offset = timezoneMiddayUtc - utcMidday;
  const targetUtc = Date.UTC(year, month - 1, day);
  return new Date(targetUtc - offset);
}

export function resolveReferenceDate(
  input?: string | null,
  timeZone: string = DEFAULT_TIME_ZONE,
): { date: Date; inputValue: string } {
  const today = startOfDayInTimeZone(new Date(), timeZone);
  if (!input || typeof input !== "string" || !input.trim()) {
    return { date: today, inputValue: formatInputDate(today, timeZone) };
  }

  const trimmed = input.trim();
  const match = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/.exec(trimmed);
  if (!match) {
    return { date: today, inputValue: formatInputDate(today, timeZone) };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const provisional = new Date(Date.UTC(year, month - 1, day));
  const zoned = startOfDayInTimeZone(provisional, timeZone);

  if (Number.isNaN(zoned.getTime())) {
    return { date: today, inputValue: formatInputDate(today, timeZone) };
  }

  return { date: zoned, inputValue: formatInputDate(zoned, timeZone) };
}

export function formatInputDate(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function formatReferenceLabel(date: Date, timeZone: string = DEFAULT_TIME_ZONE): string {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}
