import SCurveDeferred from "@/components/SCurveDeferred";

type CurvePoint = { date: string; percent: number };

type PackageSCurveSectionProps = {
  packageId: string;
  planned: CurvePoint[];
  realized: CurvePoint[];
};

export default function PackageSCurveSection({ packageId, planned, realized }: PackageSCurveSectionProps) {
  const realizedPercent = realized.length ? realized[realized.length - 1].percent : 0;
  const hasData = planned.length > 0 || realized.length > 0;

  return (
    <section className="rounded-2xl border bg-card/80 p-5 shadow-sm scurve-card print-card print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none print:p-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Curva S do pacote</h2>
          <p className="text-sm text-muted-foreground">Evolução planejada versus progresso real do pacote.</p>
        </div>
      </div>

      {hasData ? (
        <SCurveDeferred
          planned={planned}
          realizedSeries={realized}
          realizedPercent={realizedPercent}
          showMetrics={false}
          showHeader={false}
          unstyled
          className="rounded-2xl border border-border/70 bg-muted/30 p-4"
          chartHeight={360}
          visualEditingStorageKey={`package-scurve-visual:${packageId}`}
          fallback={
            <div className="flex min-h-[320px] w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
              Carregando gráfico da Curva S...
            </div>
          }
        />
      ) : (
        <div className="flex min-h-[320px] w-full items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/20 text-sm text-muted-foreground">
          Sem dados suficientes para gerar o gráfico.
        </div>
      )}
    </section>
  );
}
