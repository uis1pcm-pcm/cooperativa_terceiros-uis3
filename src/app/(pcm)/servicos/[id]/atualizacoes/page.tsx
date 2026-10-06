import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import {
  computeTimeWindowHours,
  formatDateTime,
  formatUpdateSummary,
  filterUpdatesWithRelevantContent,
  resolveUpdateTimestamp,
  toNewUpdates,
} from "../shared";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { getService, getServiceById, listUpdates } from "@/lib/repo/services";

export default async function ServiceUpdatesPage({ params }: { params: { id: string } }) {
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
  if (!baseService) return notFound();

  const updates = baseService.updates?.length
    ? toNewUpdates(baseService.updates)
    : toNewUpdates(await listUpdates(resolvedServiceId, 200));
  const updatesWithContent = filterUpdatesWithRelevantContent(updates);

  const serviceLabel =
    baseService.os?.trim() || baseService.tag?.trim() || baseService.code?.trim() || resolvedServiceId;
  const signatureCompanyLabel =
    baseService.assignedTo?.companyName?.trim() ||
    baseService.assignedTo?.companyId?.trim() ||
    baseService.company?.trim() ||
    baseService.empresa?.trim() ||
    null;
  const signatureCnpjLabel = baseService.cnpj?.trim() || null;

  return (
    <div className="container mx-auto space-y-6 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <ArrowLeft className="h-4 w-4" aria-hidden />
          <Link href={`/servicos/${encodeURIComponent(resolvedServiceId)}`} className="hover:underline">
            Voltar para o serviço
          </Link>
        </div>
        <Link className="btn btn-outline btn-sm" href={`/servicos/${encodeURIComponent(resolvedServiceId)}/editar`}>
          Editar lançamentos
        </Link>
      </div>

      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Atualizações de {serviceLabel}</h1>
        <p className="text-sm text-muted-foreground">
          Visualize todas as medições registradas para o serviço.
        </p>
      </div>

      <div className="rounded-2xl border bg-card/80 p-6 shadow-sm">
        {updatesWithContent.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma atualização registrada até o momento.</p>
        ) : (
          <ul className="space-y-3">
            {updatesWithContent.map((update) => {
              const summary = formatUpdateSummary(update);
              const hours = computeTimeWindowHours(update);
              return (
                <li key={update.id} className="space-y-2 rounded-lg border bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-base font-semibold text-foreground">{summary.title}</span>
                    <span className="text-sm font-semibold text-primary">{summary.percentLabel}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Atualizado em {formatDateTime(resolveUpdateTimestamp(update))}
                  </p>
                  {update.subactivity?.label ? (
                    <p className="text-xs text-muted-foreground">
                      Subatividade: <span className="font-medium text-foreground">{update.subactivity.label}</span>
                    </p>
                  ) : null}
                  {summary.description ? <p className="text-sm text-foreground">{summary.description}</p> : null}
                  {summary.resources ? <p className="text-xs text-muted-foreground">Recursos: {summary.resources}</p> : null}
                  {summary.hoursLabel ? <p className="text-xs text-muted-foreground">{summary.hoursLabel}</p> : null}
                  {hours === null && update.timeWindow?.start && update.timeWindow?.end ? (
                    <p className="text-xs text-muted-foreground">
                      Período: {formatDateTime(update.timeWindow.start)} → {formatDateTime(update.timeWindow.end)}
                    </p>
                  ) : null}
                  {update.impediments && update.impediments.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Impedimentos:</span>
                      <ul className="mt-1 space-y-1">
                        {update.impediments.map((item, index) => (
                          <li key={index}>
                            {item.type}
                            {item.durationHours !== null && item.durationHours !== undefined ? ` • ${item.durationHours}h` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {update.workforce && update.workforce.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Mão de obra:</span>
                      <ul className="mt-1 space-y-1">
                        {update.workforce.map((item, index) => (
                          <li key={index}>
                            {item.role}
                            {item.quantity
                              ? ` • ${item.quantity} ${item.quantity === 1 ? "profissional" : "profissionais"}`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {update.shiftConditions && update.shiftConditions.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Condições por turno:</span>
                      <ul className="mt-1 space-y-1">
                        {update.shiftConditions.map((item, index) => (
                          <li key={index}>
                            {item.shift}
                            {item.weather ? ` • ${item.weather}` : ""}
                            {item.condition ? ` • ${item.condition}` : ""}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {signatureCompanyLabel || signatureCnpjLabel ? (
                    <div className="mt-3 text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Assinatura:</span>
                      <span className="ml-1">Caixa de confirmação marcada</span>
                      <div className="mt-1 flex flex-col">
                        {signatureCompanyLabel ? <span>{signatureCompanyLabel}</span> : null}
                        {signatureCnpjLabel ? <span>CNPJ: {signatureCnpjLabel}</span> : null}
                      </div>
                    </div>
                  ) : null}
                  {update.evidences && update.evidences.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      <span className="font-semibold text-foreground">Evidências:</span>
                      <ul className="mt-1 space-y-1">
                        {update.evidences.map((item, index) => (
                          <li key={index}>
                            <a href={item.url} target="_blank" rel="noreferrer" className="text-primary underline">
                              {item.label || item.url}
                            </a>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {update.justification ? (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                      Justificativa: {update.justification}
                    </div>
                  ) : null}
                  {typeof update.criticality === "number" ? (
                    <p className="text-xs text-muted-foreground">Criticidade observada: {update.criticality}/5</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
