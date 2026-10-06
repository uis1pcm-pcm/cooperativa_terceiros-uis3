/**
 * Parsing tolerante para datas "dia/mês/ano" comuns no Brasil.
 *
 * Formatos suportados (somente data, sem hora):
 * - dd/MM/yyyy ou d/M/yyyy
 * - dd-MM-yyyy ou d-M-yyyy
 * - dd/MM/yy ou d/M/yy (2 dígitos: <50 => 20xx, >=50 => 19xx)
 * - "20 de novembro de 2025" (mês por extenso em pt-BR, com ou sem hora)
 *
 * O retorno é um Date em UTC no início do dia (00:00:00.000Z), para evitar
 * deslocamentos por fuso horário ao tratar valores "date-only".
 */
export function parseDayFirstDateStringToUtcDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;

  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year =
    yearRaw.length === 2
      ? (Number(yearRaw) < 50 ? 2000 + Number(yearRaw) : 1900 + Number(yearRaw))
      : Number(yearRaw);

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  // Rejeitar datas impossíveis (ex.: 31/02/2025) que "rolariam" o mês.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

const PORTUGUESE_MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function normaliseMonthToken(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Parsing tolerante para strings com mês por extenso em pt-BR.
 * Exemplos aceitos: "20 de novembro de 2025", "20 de novembro de 2025 às 09:00".
 */
export function parsePortugueseDateStringToUtcDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})/i);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  const monthKey = normaliseMonthToken(monthRaw);
  const month = PORTUGUESE_MONTHS[monthKey];

  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (!month) return null;
  if (day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}
