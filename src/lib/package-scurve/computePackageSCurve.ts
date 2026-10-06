export type PackageService = {
  id: string;
  hours: number;
};

export type PackageProgressEntry = {
  serviceId: string;
  workedDate: string; // YYYY-MM-DD
  percent: number;
};

export type PackageSCurvePoint = {
  date: string;
  percent: number;
};

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const parseIsoDate = (value: string) => {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(Date.UTC(year, month - 1, day));
};

const toIsoDate = (date: Date) => date.toISOString().slice(0, 10);

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

export const computePackageSCurve = (
  services: PackageService[],
  progressEntries: PackageProgressEntry[],
): PackageSCurvePoint[] => {
  if (!progressEntries.length) return [];

  const serviceHoursMap = new Map(services.map((service) => [service.id, service.hours]));
  const totalHours = services.reduce((sum, service) => sum + (Number.isFinite(service.hours) ? service.hours : 0), 0);
  if (totalHours <= 0) return [];

  const gainByDate = new Map<string, number>();
  let minDate: Date | null = null;
  let maxDate: Date | null = null;

  progressEntries.forEach((entry) => {
    const hours = serviceHoursMap.get(entry.serviceId);
    if (!Number.isFinite(hours) || hours === undefined) return;

    const entryDate = parseIsoDate(entry.workedDate);
    if (!entryDate) return;

    const gainedHours = (hours * entry.percent) / 100;
    const dateKey = toIsoDate(entryDate);
    gainByDate.set(dateKey, (gainByDate.get(dateKey) ?? 0) + gainedHours);

    if (!minDate || entryDate < minDate) minDate = entryDate;
    if (!maxDate || entryDate > maxDate) maxDate = entryDate;
  });

  if (!minDate || !maxDate) return [];

  const curve: PackageSCurvePoint[] = [];
  let accumulated = 0;

  for (let cursor = minDate; cursor <= maxDate; cursor = addDays(cursor, 1)) {
    const dateKey = toIsoDate(cursor);
    const gained = gainByDate.get(dateKey) ?? 0;
    accumulated += gained;
    const percent = clampPercent((accumulated / totalHours) * 100);
    curve.push({ date: dateKey, percent });
  }

  return curve;
};
