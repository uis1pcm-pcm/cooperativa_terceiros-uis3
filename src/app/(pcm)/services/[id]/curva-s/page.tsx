import { notFound } from "next/navigation";

import CurveSPageClient from "./CurveSPageClient";
import { curvaRealizada, dateRangeInclusive, computePlannedUniformPercent, mapSeriesToDates } from "@/lib/curvaS";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { getService } from "@/lib/repo/services";
import type { Service } from "@/lib/types";
import { formatDate as formatDateDisplay } from "@/lib/formatDateTime";

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const toDate = (input: unknown): Date | null => {
  if (!input) return null;
  if (input instanceof Date) return input;
  if (typeof input === "string") {
    const iso = input.includes("T") ? input : `${input}T00:00:00Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof input === "number") {
    const date = new Date(input);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const possibleTimestamp = input as { toDate?: () => Date };
  if (typeof possibleTimestamp?.toDate === "function") {
    const date = possibleTimestamp.toDate();
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
};

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

const formatDate = (date: Date | null) => {
  if (!date) return "";
  return formatDateDisplay(date, { timeZone: DEFAULT_TIME_ZONE, fallback: "" }) || "";
};

const buildPeriodLabel = (start: Date | null, end: Date | null) => {
  if (!start && !end) return "";
  if (start && !end) return formatDate(start);
  if (!start && end) return formatDate(end);
  if (!start || !end) return "";
  const sameDay = start.toISOString().slice(0, 10) === end.toISOString().slice(0, 10);
  if (sameDay) return formatDate(start);
  return `${formatDate(start)} até ${formatDate(end)}`;
};

const mapActualPoints = (points: Array<{ d: string; pct: number }>) => {
  const sorted = [...points].sort((a, b) => a.d.localeCompare(b.d));
  const lookup: Record<string, number> = {};
  sorted.forEach((point) => {
    lookup[point.d] = Math.round(clampPercent(point.pct));
  });
  return lookup;
};

const sanitisePlannedDaily = (plannedDaily: Service["plannedDaily"]) => {
  if (!Array.isArray(plannedDaily)) return [];
  return plannedDaily.map((value) => {
    const numeric = typeof value === "number" ? value : Number(value);
    return Number.isFinite(numeric) ? Math.round(clampPercent(numeric)) : 0;
  });
};

export default async function ServiceCurveSPage({ params }: { params: { id: string } }) {
  const rawServiceId = params.id;
  const decodedServiceId = decodeRouteParam(rawServiceId);
  const serviceIdCandidates = Array.from(
    new Set([decodedServiceId, rawServiceId].filter((value) => typeof value === "string" && value.length > 0)),
  );

  if (serviceIdCandidates.length === 0) {
    return notFound();
  }

  let service: Awaited<ReturnType<typeof getService>> | null = null;
  let resolvedServiceId = serviceIdCandidates[0];

  for (const candidate of serviceIdCandidates) {
    const candidateService = await getService(candidate);
    if (candidateService) {
      service = candidateService;
      resolvedServiceId = candidateService.id ?? candidate;
      break;
    }
  }

  if (!service) notFound();

  const start = toDate(service.plannedStart);
  const end = toDate(service.plannedEnd);
  const anchor = start ?? end;
  const startDate = start ?? anchor;
  const endDate = end ?? anchor;

  const dates = startDate && endDate ? dateRangeInclusive(startDate, endDate) : [];

  const plannedDaily = sanitisePlannedDaily(service.plannedDaily);

  let plannedMap: Record<string, number> = {};
  if (dates.length && startDate && endDate) {
    if (plannedDaily.length === dates.length) {
      plannedMap = mapSeriesToDates(dates, plannedDaily);
    } else {
      const plannedSeries = computePlannedUniformPercent(startDate, endDate, Number(service.totalHours ?? 0));
      plannedMap = mapSeriesToDates(dates, plannedSeries);
    }
  }

  const actualPoints = await curvaRealizada(service.id ?? resolvedServiceId);
  const actualLookup = mapActualPoints(actualPoints);

  const uniqueDates = new Set<string>();
  dates.forEach((date) => uniqueDates.add(date));
  actualPoints.forEach((point) => uniqueDates.add(point.d));
  const orderedDates = Array.from(uniqueDates).sort((a, b) => a.localeCompare(b));

  let lastPlanned = 0;
  let lastActual = 0;
  const combined = orderedDates.map((date) => {
    const plannedValue = plannedMap[date];
    if (typeof plannedValue === "number") {
      const clamped = Math.round(clampPercent(plannedValue));
      if (clamped > lastPlanned) lastPlanned = clamped;
    }
    const actualValue = actualLookup[date];
    if (typeof actualValue === "number") {
      const clamped = Math.round(clampPercent(actualValue));
      if (clamped > lastActual) lastActual = clamped;
    }
    return { date, planned: lastPlanned, actual: lastActual };
  });

  for (let i = 1; i < combined.length; i++) {
    if (combined[i].planned < combined[i - 1].planned) combined[i].planned = combined[i - 1].planned;
    if (combined[i].actual < combined[i - 1].actual) combined[i].actual = combined[i - 1].actual;
  }

  const hasPlannedData = orderedDates.some((date) => typeof plannedMap[date] === "number");
  if (hasPlannedData && combined.length) {
    combined[combined.length - 1].planned = 100;
    for (let i = combined.length - 2; i >= 0; i--) {
      if (combined[i].planned > combined[i + 1].planned) combined[i].planned = combined[i + 1].planned;
    }
  }

  const serviceName = service.equipmentName?.trim() || service.tag?.trim() || service.os || `Serviço ${service.id}`;
  const periodLabel = buildPeriodLabel(startDate, endDate);

  return (
    <CurveSPageClient
      serviceId={service.id}
      serviceName={serviceName}
      periodLabel={periodLabel}
      combined={combined}
    />
  );
}
