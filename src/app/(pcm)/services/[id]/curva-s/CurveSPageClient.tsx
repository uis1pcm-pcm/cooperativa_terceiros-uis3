"use client";

import { toCsv } from "@/lib/curvaSShared";
import SCurveDeferred from "@/components/SCurveDeferred";

type CombinedPoint = { date: string; planned: number; actual: number };

type CurveSPageClientProps = {
  serviceId: string;
  serviceName: string;
  periodLabel: string;
  combined: CombinedPoint[];
};

export default function CurveSPageClient({ serviceId, serviceName, periodLabel, combined }: CurveSPageClientProps) {
  const hasData = combined.length > 0;

  const planned = combined.map((point) => ({ date: point.date, percent: point.planned }));
  const realizedSeries = combined.map((point) => ({ date: point.date, percent: point.actual }));
  const realizedPercent = combined.length ? combined[combined.length - 1].actual : 0;
  const plannedToDate = combined.length ? combined[combined.length - 1].planned : 0;
  const delta = realizedPercent - plannedToDate;

  const deltaToneClass =
    delta < -2
      ? "text-amber-600 dark:text-amber-400"
      : delta > 2
        ? "text-emerald-600 dark:text-emerald-400"
        : "text-foreground";

  const downloadCsv = () => {
    if (!hasData) return;
    const rows = combined.map((r) => ({ date: r.date, planned: r.planned, actual: r.actual }));
    const csv = toCsv(rows);
    if (!csv) return;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `curva-s-${serviceId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container-page space-y-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">Curva S</h1>
        <p className="text-sm text-muted-foreground">
          {serviceName}
          {periodLabel ? ` · Período: ${periodLabel}` : null}
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-muted/20 p-4 text-sm">
        <div className="space-y-1">
          <p className="font-medium text-foreground">{serviceName}</p>
          {periodLabel ? <p className="text-muted-foreground">Período planejado: {periodLabel}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-outline h-11 px-5" onClick={downloadCsv} disabled={!hasData}>
            Baixar CSV
          </button>
          <button type="button" className="btn btn-secondary h-11 px-5" onClick={() => window.print()}>
            Imprimir / PDF
          </button>
        </div>
      </div>

      {hasData ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-start">
          <section className="rounded-2xl border bg-card/80 p-5 shadow-sm scurve-card">
            <SCurveDeferred
              planned={planned}
              realizedSeries={realizedSeries}
              realizedPercent={realizedPercent}
              title="Curva S do serviço"
              description="Planejado versus realizado considerando o serviço."
              headerAside={<span className="font-medium text-foreground">Realizado: {Math.round(realizedPercent)}%</span>}
              chartHeight={420}
              metrics={{
                plannedToDate,
                realized: realizedPercent,
                plannedTotal: 100,
                delta,
              }}
              showMetrics={false}
              fallback={
                <div className="flex h-[420px] w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/40">
                  <span className="text-sm text-muted-foreground">Carregando gráfico...</span>
                </div>
              }
            />
          </section>

          <section className="w-full rounded-2xl border bg-card/80 px-4 py-3 shadow-sm xl:max-w-[260px]">
            <h2 className="mb-3 text-lg font-semibold">Indicadores da curva</h2>
            <dl className="space-y-3 text-sm">
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <dt className="text-muted-foreground">Planejado (total)</dt>
                <dd className="text-lg font-semibold text-foreground">100%</dd>
              </div>
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <dt className="text-muted-foreground">Planejado até hoje</dt>
                <dd className="text-lg font-semibold text-foreground">{Math.round(plannedToDate)}%</dd>
              </div>
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <dt className="text-muted-foreground">Realizado</dt>
                <dd className="text-lg font-semibold text-emerald-600 dark:text-emerald-400">{Math.round(realizedPercent)}%</dd>
              </div>
              <div className="rounded-xl border bg-muted/30 px-3 py-2.5">
                <dt className="text-muted-foreground">Diferença</dt>
                <dd className={`text-lg font-semibold ${deltaToneClass}`}>
                  {delta > 0 ? "+" : ""}
                  {Math.round(delta)}%
                </dd>
              </div>
            </dl>
          </section>
        </div>
      ) : (
        <div className="flex h-[520px] w-full items-center justify-center rounded-lg border border-dashed border-border/60 bg-muted/20 text-sm text-muted-foreground md:h-[600px]">
          Sem dados suficientes para gerar o gráfico.
        </div>
      )}
    </div>
  );
}
