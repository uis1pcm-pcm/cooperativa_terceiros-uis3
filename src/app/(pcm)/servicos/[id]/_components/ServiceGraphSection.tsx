"use client";

import { useCallback, useMemo } from "react";

import SCurveDeferred from "@/components/SCurveDeferred";
import type { Service } from "@/lib/types";
import { formatDate } from "@/lib/formatDateTime";

type CurvePoint = { d: string; pct: number };

type ServiceGraphSectionProps = {
  service: Pick<
    Service,
    | "id"
    | "os"
    | "equipmentName"
    | "company"
    | "tag"
    | "plannedStart"
    | "plannedEnd"
    | "totalHours"
  > | null;
  planned: CurvePoint[];
  actual: CurvePoint[];
};

const UTC_TIME_ZONE = "UTC";

const toDateLabel = (iso: string | undefined | null) => {
  if (!iso) return "—";
  const value = iso.includes("T") ? iso : `${iso}T00:00:00Z`;
  const formatted = formatDate(value, { timeZone: UTC_TIME_ZONE, fallback: "—" });
  return formatted || "—";
};

const unionDates = (planned: CurvePoint[], actual: CurvePoint[]) => {
  const set = new Set<string>();
  planned.forEach((point) => set.add(point.d));
  actual.forEach((point) => set.add(point.d));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
};

export default function ServiceGraphSection({ service, planned, actual }: ServiceGraphSectionProps) {
  const rows = useMemo(() => {
    const dates = unionDates(planned, actual);
    const plannedMap = new Map(planned.map((point) => [point.d, point.pct]));
    const actualMap = new Map(actual.map((point) => [point.d, point.pct]));

    return dates.map((date) => ({
      date,
      planned: plannedMap.get(date) ?? null,
      actual: actualMap.get(date) ?? null,
    }));
  }, [planned, actual]);

  const handlePrint = useCallback(() => {
    if (typeof window === "undefined") return;
    window.print();
  }, []);

  const handleExportCsv = useCallback(() => {
    if (!rows.length || typeof window === "undefined") return;
    const header = "data,planejado,realizado";
    const lines = rows.map(({ date, planned: planValue, actual: actValue }) => {
      const plannedPct = planValue ?? "";
      const actualPct = actValue ?? "";
      return `${date},${plannedPct},${actualPct}`;
    });
    const csvContent = [header, ...lines].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `curva-s-servico-${service?.id ?? "desconhecido"}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }, [rows, service?.id]);

  const serviceName = useMemo(() => {
    if (!service) return "Serviço";
    const name = service.equipmentName?.trim();
    if (name) return name;
    const tag = service.tag?.trim();
    if (tag) return tag;
    return `Serviço ${service.id}`;
  }, [service]);

  const plannedPeriod = useMemo(() => {
    if (!service) return "—";
    const start = toDateLabel(service.plannedStart);
    const end = toDateLabel(service.plannedEnd);
    if (start === "—" && end === "—") return "—";
    if (start === "—") return end;
    if (end === "—") return start;
    if (start === end) return start;
    return `${start} até ${end}`;
  }, [service]);

  const latestPlanned = planned.length ? planned[planned.length - 1] : null;
  const latestActual = actual.length ? actual[actual.length - 1] : null;
  const chartFallback = (
    <div className="flex min-h-[320px] w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
      Carregando gráfico da Curva S...
    </div>
  );
  const scurvePlanned = useMemo(
    () => planned.map((point) => ({ date: point.d, percent: point.pct })),
    [planned],
  );
  const scurveRealized = useMemo(
    () => actual.map((point) => ({ date: point.d, percent: point.pct })),
    [actual],
  );
  const realizedPercent = latestActual?.pct ?? 0;

  return (
    <section className="card space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Curva S</h2>
          <p className="text-sm text-muted-foreground">
            Evolução planejada versus progresso real do serviço.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-secondary" onClick={handlePrint}>
            Imprimir/Salvar PDF
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={handleExportCsv}
            disabled={!rows.length}
          >
            Exportar CSV
          </button>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border border-border/70 bg-muted/30 p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Serviço</span>
          <p className="mt-1 font-medium text-foreground">{serviceName}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">OS</span>
          <p className="mt-1 font-medium text-foreground">{service?.os || "—"}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa</span>
          <p className="mt-1 font-medium text-foreground">{service?.company || "—"}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Período planejado
          </span>
          <p className="mt-1 font-medium text-foreground">{plannedPeriod}</p>
        </div>
      </div>

      <SCurveDeferred
        planned={scurvePlanned}
        realizedSeries={scurveRealized}
        realizedPercent={realizedPercent}
        showMetrics={false}
        showHeader={false}
        unstyled
        className="rounded-2xl border border-border/70 bg-muted/30 p-4"
        chartHeight={360}
        fallback={chartFallback}
      />

      <div className="grid gap-4 rounded-lg border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground sm:grid-cols-2 lg:grid-cols-3">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide">Última medição planejada</span>
          <p className="mt-1 text-base font-semibold text-foreground">
            {latestPlanned ? `${latestPlanned.pct.toFixed(2)}%` : "—"}
          </p>
          <p className="text-xs">{latestPlanned ? toDateLabel(latestPlanned.d) : "Sem registros"}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide">Último progresso real</span>
          <p className="mt-1 text-base font-semibold text-foreground">
            {latestActual ? `${latestActual.pct.toFixed(2)}%` : "—"}
          </p>
          <p className="text-xs">{latestActual ? toDateLabel(latestActual.d) : "Sem registros"}</p>
        </div>
        <div>
          <span className="text-xs font-semibold uppercase tracking-wide">Horas previstas</span>
          <p className="mt-1 text-base font-semibold text-foreground">
            {service && Number.isFinite(service.totalHours) ? `${service.totalHours} h` : "—"}
          </p>
          <p className="text-xs">Total estimado cadastrado para o serviço.</p>
        </div>
      </div>
    </section>
  );
}
