import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { PublicAccessError, requireServiceAccess } from "@/lib/public-access";
import { addManualUpdate } from "@/lib/repo/services";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";
import { parseDayFirstDateStringToUtcDate, parsePortugueseDateStringToUtcDate } from "@/lib/dateParsing";

const SHIFT_VALUES = new Set(["manha", "tarde", "noite"]);
const WEATHER_VALUES = new Set(["claro", "nublado", "chuvoso"]);
const CONDITION_VALUES = new Set(["praticavel", "impraticavel"]);

function parseReportDateInput(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;

    const brDate = parseDayFirstDateStringToUtcDate(trimmed);
    if (brDate) return brDate.getTime();

    const ptDate = parsePortugueseDateStringToUtcDate(trimmed);
    if (ptDate) return ptDate.getTime();

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const serviceId = searchParams.get("serviceId") ?? "";
  const queryToken = searchParams.get("token");
  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("access_token")?.value ?? "";
  const token = queryToken && queryToken.trim() ? queryToken.trim() : cookieToken;

  try {
    const { service } = await requireServiceAccess(token, serviceId);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;

    const percentRaw = Number(body.percent);
    if (!Number.isFinite(percentRaw)) {
      throw new PublicAccessError(400, "percent inválido");
    }

    const description = typeof body.description === "string" ? body.description.trim() : "";
    if (!description) {
      throw new PublicAccessError(400, "description obrigatória");
    }

    const declarationAccepted = body.declarationAccepted === true;
    if (!declarationAccepted) {
      throw new PublicAccessError(400, "declaration_required");
    }

    const timeWindowRaw = (body.timeWindow ?? {}) as Record<string, unknown>;
    const startRaw = typeof timeWindowRaw.start === "string" ? timeWindowRaw.start : undefined;
    const endRaw = typeof timeWindowRaw.end === "string" ? timeWindowRaw.end : undefined;
    const startDate = startRaw ? new Date(startRaw) : null;
    const endDate = endRaw ? new Date(endRaw) : null;
    if (!startDate || Number.isNaN(startDate.getTime())) {
      throw new PublicAccessError(400, "start inválido");
    }
    if (!endDate || Number.isNaN(endDate.getTime())) {
      throw new PublicAccessError(400, "end inválido");
    }
    if (endDate.getTime() < startDate.getTime()) {
      throw new PublicAccessError(400, "período inválido");
    }

    const hours = Math.max(0, (endDate.getTime() - startDate.getTime()) / 3_600_000);

    const subactivityRaw = (body.subactivity ?? {}) as Record<string, unknown>;
    const subactivityId = typeof subactivityRaw.id === "string" && subactivityRaw.id.trim() ? subactivityRaw.id.trim() : undefined;
    const subactivityLabel =
      typeof subactivityRaw.label === "string" && subactivityRaw.label.trim() ? subactivityRaw.label.trim() : undefined;

    const mode = body.mode === "detailed" ? "detailed" : "simple";

    const impediments = Array.isArray(body.impediments)
      ? (body.impediments as Array<Record<string, unknown>>)
          .map((item) => {
            const type = typeof item.type === "string" ? item.type.trim() : "";
            if (!type) return null;
            const duration = Number(item.durationHours);
            return {
              type,
              durationHours: Number.isFinite(duration) && duration >= 0 ? Number(duration) : null,
            };
          })
          .filter(Boolean)
          .slice(0, 5) as Array<{ type: string; durationHours?: number | null }>
      : undefined;

    const resources = Array.isArray(body.resources)
      ? (body.resources as Array<Record<string, unknown>>)
          .map((item) => {
            const name = typeof item.name === "string" ? item.name.trim() : "";
            if (!name) return null;
            const quantity = Number(item.quantity);
            const unit = typeof item.unit === "string" && item.unit.trim() ? item.unit.trim() : null;
            return {
              name,
              quantity: Number.isFinite(quantity) && quantity >= 0 ? Number(quantity) : null,
              unit,
            };
          })
          .filter(Boolean)
          .slice(0, 8) as Array<{ name: string; quantity?: number | null; unit?: string | null }>
      : undefined;

    const workforce = Array.isArray(body.workforce)
      ? (body.workforce as Array<Record<string, unknown>>)
          .map((item) => {
            const role = typeof item.role === "string" ? item.role.trim() : "";
            if (!role) return null;
            const quantityRaw = Number(item.quantity);
            const quantity = Number.isFinite(quantityRaw) ? Math.max(1, Math.round(quantityRaw)) : null;
            if (!quantity) return null;
            return { role, quantity };
          })
          .filter(Boolean)
          .slice(0, 12) as Array<{ role: string; quantity: number }>
      : undefined;

    const shiftConditions = Array.isArray(body.shiftConditions)
      ? (body.shiftConditions as Array<Record<string, unknown>>)
          .map((item) => {
            const shift = typeof item.shift === "string" ? item.shift.trim().toLowerCase() : "";
            const weather = typeof item.weather === "string" ? item.weather.trim().toLowerCase() : "";
            const condition = typeof item.condition === "string" ? item.condition.trim().toLowerCase() : "";
            if (!SHIFT_VALUES.has(shift) || !WEATHER_VALUES.has(weather) || !CONDITION_VALUES.has(condition)) {
              return null;
            }
            return {
              shift: shift as "manha" | "tarde" | "noite",
              weather: weather as "claro" | "nublado" | "chuvoso",
              condition: condition as "praticavel" | "impraticavel",
            };
          })
          .filter(Boolean)
          .slice(0, 3) as Array<{
          shift: "manha" | "tarde" | "noite";
          weather: "claro" | "nublado" | "chuvoso";
          condition: "praticavel" | "impraticavel";
        }>
      : undefined;

    const forecastDateRaw = typeof body.forecastDate === "string" ? body.forecastDate : undefined;
    const forecastDate = forecastDateRaw ? new Date(forecastDateRaw) : null;
    const forecastMillis = forecastDate && !Number.isNaN(forecastDate.getTime()) ? forecastDate.getTime() : null;

    const criticalityRaw = Number(body.criticality);
    const criticality = Number.isFinite(criticalityRaw) ? Math.round(Math.max(1, Math.min(5, criticalityRaw))) : null;

    const evidences = Array.isArray(body.evidences)
      ? (body.evidences as Array<Record<string, unknown>>)
          .map((item) => {
            const url = typeof item.url === "string" ? item.url.trim() : "";
            if (!url) return null;
            try {
              const parsed = new URL(url);
              if (!parsed.protocol) return null;
            } catch {
              return null;
            }
            const label = typeof item.label === "string" && item.label.trim() ? item.label.trim() : undefined;
            return { url, label };
          })
          .filter(Boolean)
          .slice(0, 5) as Array<{ url: string; label?: string | null }>
      : undefined;

    const previousPercent = [service.realPercent, service.manualPercent, service.andamento]
      .map((value) => {
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value === "string" && value.trim()) {
          const parsed = Number(value);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      })
      .reduce<number | null>((acc, value) => {
        if (value === null) return acc;
        if (acc === null) return value;
        return Math.max(acc, value);
      }, null);
    const justification = typeof body.justification === "string" ? body.justification.trim() : "";

    const ipHeader = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip")?.trim() || null;

    // reportDate deve ser persistido como timestamp (millis) para evitar strings ambíguas.
    const reportDateMillis = parseReportDateInput(body.reportDate) ?? startDate.getTime();

    const { realPercent, update } = await addManualUpdate(service.id, {
      manualPercent: percentRaw,
      description,
      token,
      mode,
      declarationAccepted,
      timeWindow: {
        start: startDate.getTime(),
        end: endDate.getTime(),
        hours,
      },
      reportDate: reportDateMillis,
      subactivity: subactivityId || subactivityLabel ? { id: subactivityId, label: subactivityLabel } : undefined,
      impediments,
      resources,
      workforce,
      shiftConditions,
      forecastDate: forecastMillis,
      criticality: criticality ?? undefined,
      evidences,
      justification: justification || undefined,
      previousPercent,
      ip: ipHeader,
    }, { skipRecompute: true });

    return NextResponse.json({ ok: true, realPercent, update });
  } catch (err: unknown) {
    if (err instanceof PublicAccessError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }

    const firestoreError = mapFirestoreError(err);
    if (firestoreError) {
      return NextResponse.json({ ok: false, error: firestoreError.message }, { status: firestoreError.status });
    }

    if (err instanceof Error && err.message.includes("Serviço não encontrado")) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 404 });
    }

    console.error("[api/public/service/update-manual] Falha inesperada", err);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
