export type IsoDate = string;

export function dateRangeInclusive(start: Date, end: Date): IsoDate[] {
  const norm = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const s = norm(start);
  const e = norm(end);
  const out: IsoDate[] = [];
  for (let d = new Date(s); d.getTime() <= e.getTime(); d.setUTCDate(d.getUTCDate() + 1)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export function computePlannedUniformPercent(start: Date, end: Date, totalHours: number): number[] {
  const days = dateRangeInclusive(start, end);
  const n = days.length;
  if (n <= 0 || !Number.isFinite(totalHours) || totalHours <= 0) return [];
  const step = 100 / n;
  const arr = Array.from({ length: n }, (_, i) => Math.round((i + 1) * step));
  arr[arr.length - 1] = 100;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] < arr[i - 1]) arr[i] = arr[i - 1];
  }
  return arr;
}

export function mapSeriesToDates(dates: IsoDate[], series: number[]): Record<IsoDate, number> {
  const out: Record<IsoDate, number> = {};
  for (let i = 0; i < dates.length; i++) out[dates[i]] = Math.round(series[i] ?? 0);
  return out;
}

export function toCsv(rows: Array<Record<string, string | number>>): string {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const body = rows.map((r) => headers.map((h) => r[h]).join(",")).join("\n");
  return headers.join(",") + "\n" + body;
}
