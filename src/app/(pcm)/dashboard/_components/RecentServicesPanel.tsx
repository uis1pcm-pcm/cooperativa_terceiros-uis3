"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { formatDateTime } from "@/lib/formatDateTime";
import { resolveReferenceDate } from "@/lib/referenceDate";
import { resolveServicoPercentualPlanejado, resolveServicoRealPercent } from "@/lib/serviceProgress";
import { resolveDisplayedServiceStatus } from "@/lib/serviceStatus";
import type { Service } from "@/types";

const STATUS_TONE: Record<string, string> = {
  Aberto: "bg-sky-100 text-sky-700 border-sky-200",
  Pendente: "bg-amber-100 text-amber-700 border-amber-200",
  Concluído: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

export default function RecentServicesPanel({ services }: { services: Service[] }) {
  const searchParams = useSearchParams();
  const refDateParam = searchParams?.get("refDate") ?? null;
  const { date: referenceDate } = useMemo(() => resolveReferenceDate(refDateParam), [refDateParam]);

  return (
    <div className="space-y-2">
      {services.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Nenhum serviço cadastrado.
        </div>
      ) : (
        services.slice(0, 5).map((service) => {
          const plannedPercent = Math.round(resolveServicoPercentualPlanejado(service, referenceDate));
          const realPercent = Math.round(resolveServicoRealPercent(service, referenceDate));
          const statusLabel = resolveDisplayedServiceStatus(service, { referenceDate });
          const statusTone = STATUS_TONE[statusLabel] ?? "border-border bg-muted text-foreground/80";
          const createdAt = (service as { createdAt?: number | null }).createdAt;
          const lastUpdate = service.updatedAt ?? createdAt ?? null;
          const lastUpdateLabel =
            typeof lastUpdate === "number"
              ? formatDateTime(lastUpdate, { timeZone: "America/Sao_Paulo", fallback: "" })
              : "";
          const serviceHref = `/servicos/${encodeURIComponent(service.id)}`;
          return (
            <div
              key={service.id}
              className="flex flex-wrap items-center gap-3 rounded-lg border p-3 transition hover:border-primary/40 hover:bg-muted/40"
            >
              <Link className="min-w-0 flex-1 space-y-1" href={serviceHref}>
                <div className="flex items-start justify-between gap-2">
                  <p className="truncate text-sm font-medium">
                    {service.os || service.code || service.id}
                    {service.equipmentName ? ` — ${service.equipmentName}` : service.tag ? ` — ${service.tag}` : ""}
                  </p>
                  {lastUpdateLabel ? (
                    <span className="whitespace-nowrap text-[11px] text-muted-foreground">Última atualização {lastUpdateLabel}</span>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone}`}>
                    {statusLabel}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Planejado: <span className="font-semibold text-foreground">{plannedPercent}%</span> | Real:{" "}
                  <span className="font-semibold text-foreground">{realPercent}%</span>
                </p>
              </Link>
            </div>
          );
        })
      )}
    </div>
  );
}
