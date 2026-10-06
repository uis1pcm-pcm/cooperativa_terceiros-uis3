import { computeProgressHistory } from "@/lib/progressHistoryServer";

import type { IsoDate } from "./curvaSShared";
import { computePlannedUniformPercent, dateRangeInclusive } from "./curvaSShared";

export type { IsoDate } from "./curvaSShared";
export { computePlannedUniformPercent, dateRangeInclusive, mapSeriesToDates, toCsv } from "./curvaSShared";

type CurvePoint = { d: IsoDate; pct: number };

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const normaliseDate = (value: Date | null | undefined): Date | null => {
  if (!value) return null;
  if (!(value instanceof Date)) return null;
  const time = value.getTime();
  if (!Number.isFinite(time)) return null;
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
};

const toIsoDate = (value: Date): IsoDate => value.toISOString().slice(0, 10) as IsoDate;
const toIsoDateFromDate = (value: Date | null | undefined): IsoDate | null => {
  const normalised = normaliseDate(value);
  if (!normalised) return null;
  return toIsoDate(normalised);
};
const toIsoDateFromMillis = (value: number): IsoDate => {
  const date = new Date(value);
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  return toIsoDate(day);
};

type PackageServiceHours = {
  id: string;
  hours: number;
};

export function curvaPlanejada(inicio: Date, fim: Date, horasTotais: number): CurvePoint[] {
  const start = normaliseDate(inicio);
  const end = normaliseDate(fim);
  const anchor = start ?? end;
  if (!anchor) return [];

  const [first, last] = (() => {
    const a = start ?? anchor;
    const b = end ?? anchor;
    return a.getTime() <= b.getTime() ? [a, b] : [b, a];
  })();

  const dates = dateRangeInclusive(first, last);
  if (!dates.length) return [];

  const plannedSeries = computePlannedUniformPercent(first, last, horasTotais);
  const hasSeries = plannedSeries.length === dates.length;

  let lastPct = 0;
  const points = dates.map((date, index) => {
    let pct: number;
    if (hasSeries) {
      const value = plannedSeries[index] ?? lastPct;
      pct = Math.round(clampPercent(value));
    } else {
      pct = index === dates.length - 1 ? 100 : lastPct;
    }
    if (pct < lastPct) pct = lastPct;
    if (index === dates.length - 1) pct = 100;
    lastPct = pct;
    return { d: date, pct };
  });

  return points;
}

export async function curvaRealizada(serviceId: string): Promise<CurvePoint[]> {
  const history = await computeProgressHistory(serviceId);
  if (!history) return [];

  return Array.from(history.byDay.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([d, pct]) => ({ d: d as IsoDate, pct: Math.round(pct) }));
}

export async function curvaRealizadaPacote(
  services: PackageServiceHours[],
  plannedStart?: Date | null,
  plannedEnd?: Date | null,
): Promise<CurvePoint[]> {
  if (!services.length) return [];

  const validServices = services.filter((service) => Number.isFinite(service.hours) && service.hours > 0);
  const totalHours = validServices.reduce((sum, service) => sum + service.hours, 0);
  if (!validServices.length || totalHours <= 0) return [];

  const histories = await Promise.all(
    validServices.map(async (service) => {
      const history = await computeProgressHistory(service.id);
      return { service, history };
    }),
  );

  const dateSet = new Set<IsoDate>();
  let lastHistoryDate: IsoDate | null = null;
  let lastExplicitHistoryDate: IsoDate | null = null;
  let hasRealizedLaunch = false;

  histories.forEach(({ history }) => {
    history?.byDay.forEach((_, key) => {
      hasRealizedLaunch = true;
      const isoKey = key as IsoDate;
      dateSet.add(isoKey);
      if (!lastHistoryDate || isoKey.localeCompare(lastHistoryDate) > 0) {
        lastHistoryDate = isoKey;
      }
    });
    if (history?.lastExplicitTimestamp) {
      const explicitDate = toIsoDateFromMillis(history.lastExplicitTimestamp);
      if (!lastExplicitHistoryDate || explicitDate.localeCompare(lastExplicitHistoryDate) > 0) {
        lastExplicitHistoryDate = explicitDate;
      }
    }
  });

  if (!hasRealizedLaunch) return [];

  const start = normaliseDate(plannedStart ?? null);
  const end = normaliseDate(plannedEnd ?? null);
  const startDateKey = toIsoDateFromDate(start);
  if (start && end) {
    dateRangeInclusive(start, end).forEach((date) => dateSet.add(date));
  }

  const allDates = Array.from(dateSet).sort((left, right) => left.localeCompare(right));
  const cutoffDate = lastExplicitHistoryDate ?? lastHistoryDate;
  const graphStart = startDateKey ?? allDates[0] ?? null;
  if (!graphStart) return [];

  const curveDates = allDates.filter(
    (dateKey) => dateKey.localeCompare(graphStart) >= 0 && (cutoffDate === null || dateKey.localeCompare(cutoffDate) <= 0),
  );
  if (!curveDates.length) return [];

  const lastPercentByService = new Map<string, number>();
  const curve: CurvePoint[] = [];

  if (graphStart) {
    const historyDatesBeforeStart = allDates.filter((dateKey) => dateKey.localeCompare(graphStart) < 0);
    historyDatesBeforeStart.forEach((dateKey) => {
      histories.forEach(({ service, history }) => {
        if (!history) return;
        const percentForDay = history.byDay.get(dateKey);
        if (typeof percentForDay === "number" && Number.isFinite(percentForDay)) {
          lastPercentByService.set(service.id, percentForDay);
        }
      });
    });
  }

  curveDates.forEach((dateKey) => {
    let earnedHours = 0;
    histories.forEach(({ service, history }) => {
      if (!history) return;
      const percentForDay = history.byDay.get(dateKey);
      if (typeof percentForDay === "number" && Number.isFinite(percentForDay)) {
        lastPercentByService.set(service.id, percentForDay);
      }
      const resolvedPercent = lastPercentByService.get(service.id) ?? 0;
      earnedHours += (service.hours * resolvedPercent) / 100;
    });

    const percent = clampPercent((earnedHours / totalHours) * 100);
    curve.push({ d: dateKey, pct: Math.round(percent) });
  });

  return curve;
}
