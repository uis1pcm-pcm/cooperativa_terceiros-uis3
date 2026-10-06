import { NextResponse } from "next/server";

import { curvaPlanejada, curvaRealizada } from "@/lib/curvaS";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { getService } from "@/lib/repo/services";

const parseISODate = (value: string | null | undefined): Date | null => {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

export async function GET(
  _req: Request,
  context: { params: Promise<{ serviceId: string }> },
): Promise<NextResponse> {
  const { serviceId } = await context.params;
  const decodedServiceId = decodeRouteParam(serviceId);
  const serviceIdCandidates = Array.from(
    new Set([decodedServiceId, serviceId].filter((value) => typeof value === "string" && value.length > 0)),
  );

  if (serviceIdCandidates.length === 0) {
    return NextResponse.json({ ok: false, error: "serviceId ausente" }, { status: 400 });
  }

  try {
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

    if (!service) {
      return NextResponse.json({ ok: false, error: "Serviço não encontrado" }, { status: 404 });
    }

    const inicio = parseISODate(service.plannedStart);
    const fim = parseISODate(service.plannedEnd);

    const planned = inicio || fim
      ? curvaPlanejada(inicio ?? fim ?? new Date(), fim ?? inicio ?? new Date(), service.totalHours ?? 0)
      : [];
    const actual = await curvaRealizada(service.id ?? resolvedServiceId);

    const plannedMap = new Map(planned.map((point) => [point.d, point.pct]));
    const actualMap = new Map(actual.map((point) => [point.d, point.pct]));

    const labels = Array.from(new Set([...plannedMap.keys(), ...actualMap.keys()]));
    labels.sort((a, b) => a.localeCompare(b));

    let plannedAccumulator = 0;
    let actualAccumulator = 0;

    const points = labels.map((date) => {
      if (plannedMap.has(date)) {
        plannedAccumulator = Math.max(plannedAccumulator, clampPercent(plannedMap.get(date) ?? 0));
      }
      if (actualMap.has(date)) {
        actualAccumulator = Math.max(actualAccumulator, clampPercent(actualMap.get(date) ?? 0));
      }
      return {
        date,
        planned: plannedAccumulator,
        realized: actualAccumulator,
      };
    });

    return NextResponse.json(
      { ok: true, points },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[api/pcm/servicos/scurve] Falha ao gerar curva", error);
    return NextResponse.json({ ok: false, error: "Erro interno" }, { status: 500 });
  }
}
