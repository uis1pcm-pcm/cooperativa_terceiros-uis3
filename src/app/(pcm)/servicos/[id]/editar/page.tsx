export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";
import { notFound } from "next/navigation";

import ServiceEditorClient from "../ServiceEditorClient";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { getService, getServiceById } from "@/lib/repo/services";

export default async function ServiceEditPage({ params }: { params: { id: string } }) {
  const rawServiceId = params.id;
  const decodedServiceId = decodeRouteParam(rawServiceId);
  const serviceIdCandidates = Array.from(
    new Set([decodedServiceId, rawServiceId].filter((value) => typeof value === "string" && value.length > 0)),
  );

  if (serviceIdCandidates.length === 0) {
    return notFound();
  }

  let service: Awaited<ReturnType<typeof getServiceById>> | null = null;
  let legacyService: Awaited<ReturnType<typeof getService>> | null = null;
  let resolvedServiceId = serviceIdCandidates[0];

  for (const candidate of serviceIdCandidates) {
    const [candidateService, candidateLegacy] = await Promise.all([
      getServiceById(candidate),
      getService(candidate),
    ]);

    if (candidateService || candidateLegacy) {
      service = candidateService;
      legacyService = candidateLegacy;
      resolvedServiceId = candidateService?.id ?? candidateLegacy?.id ?? candidate;
      break;
    }
  }

  const baseService = service ?? legacyService;
  if (!baseService) notFound();

  const serviceLabel =
    baseService.os?.trim() ||
    baseService.tag?.trim() ||
    baseService.code?.trim() ||
    resolvedServiceId;

  return (
    <div className="container mx-auto space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Editar serviço {serviceLabel}</h1>
          <p className="text-sm text-muted-foreground">
            Atualize os dados gerais, checklist e histórico de medições do serviço.
          </p>
        </div>
        <Link className="btn btn-secondary" href={`/servicos/${encodeURIComponent(resolvedServiceId)}`}>
          Voltar
        </Link>
      </div>

      <ServiceEditorClient serviceId={resolvedServiceId} />
    </div>
  );
}
