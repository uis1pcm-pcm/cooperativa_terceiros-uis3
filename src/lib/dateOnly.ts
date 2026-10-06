const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const BR_DATE_ONLY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export type DateOnlyParts = {
  year: number;
  month: number;
  day: number;
};

function buildParts(yearStr: string, monthStr: string, dayStr: string): DateOnlyParts | null {
  const year = Number.parseInt(yearStr, 10);
  const month = Number.parseInt(monthStr, 10);
  const day = Number.parseInt(dayStr, 10);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return { year, month, day };
}

export function parseDateOnly(value: string): DateOnlyParts | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const isoMatch = ISO_DATE_ONLY.exec(trimmed);
  if (isoMatch) {
    return buildParts(isoMatch[1] ?? "", isoMatch[2] ?? "", isoMatch[3] ?? "");
  }

  const brMatch = BR_DATE_ONLY.exec(trimmed);
  if (brMatch) {
    return buildParts(brMatch[3] ?? "", brMatch[2] ?? "", brMatch[1] ?? "");
  }

  return null;
}

export function dateOnlyToMillis(parts: DateOnlyParts): number {
  return Date.UTC(parts.year, parts.month - 1, parts.day);
}

export function formatDateOnly(parts: DateOnlyParts): string {
  const year = String(parts.year).padStart(4, "0");
  const month = String(parts.month).padStart(2, "0");
  const day = String(parts.day).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function formatDateOnlyBR(parts: DateOnlyParts): string {
  const day = String(parts.day).padStart(2, "0");
  const month = String(parts.month).padStart(2, "0");
  const year = String(parts.year).padStart(4, "0");
  return `${day}/${month}/${year}`;
}

export function maskDateOnlyInput(value: string): string {
  if (typeof value !== "string") {
    return "";
  }

  const parsed = parseDateOnly(value);
  if (parsed) {
    return formatDateOnlyBR(parsed);
  }

  const digits = value.replace(/\D/g, "").slice(0, 8);

  if (digits.length <= 2) {
    return digits;
  }

  if (digits.length <= 4) {
    return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  }

  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}
