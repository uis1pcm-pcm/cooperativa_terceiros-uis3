"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import type { TooltipProps } from "recharts";
import {
  LabelList,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  CartesianGrid,
  YAxis,
} from "recharts";

import { cn } from "@/lib/utils";
import { formatLongDate, formatShortMonthDate } from "@/lib/formatDateTime";
import {
  ACTIVE_DOT_RADIUS,
  DOT_RADIUS,
  LINE_STROKE_WIDTH,
  PLANNED_COLOR,
  REALIZED_COLOR,
} from "./charts/colors";

type PlannedPoint = { date: string; percent: number; hoursAccum?: number };
type CurvePoint = { date: string; percent: number };

type SCurveMetrics = {
  plannedTotal?: number | null;
  plannedToDate?: number | null;
  realized?: number | null;
  delta?: number | null;
};

export type SCurveProps = {
  planned: PlannedPoint[];
  realizedSeries: CurvePoint[];
  realizedPercent: number;
  title?: string;
  description?: string;
  headerAside?: ReactNode;
  className?: string;
  chartHeight?: number;
  deferRendering?: boolean;
  metrics?: SCurveMetrics;
  showMetrics?: boolean;
  showHeader?: boolean;
  unstyled?: boolean;
  visualEditingStorageKey?: string;
};

type ChartEntry = {
  date: string;
  dateLabel: string;
  planned: number | null;
  realized: number | null;
  plannedHours: number | null;
};

type TooltipPayload = TooltipProps<number, string>;

function toDayIso(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatShortDate(value: string) {
  return formatShortMonthDate(value, { timeZone: "UTC", fallback: value }) || value;
}

function formatFullDate(value: string) {
  return formatLongDate(value, { timeZone: "UTC", fallback: value }) || value;
}

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: "neutral" | "positive" | "warning" }) {
  const toneClass =
    tone === "positive"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warning"
        ? "text-amber-600 dark:text-amber-400"
        : "text-foreground";
  return (
    <div className="rounded-lg border border-dashed bg-background/60 p-2 shadow-[0_1px_3px_rgba(0,0,0,0.08)]">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold leading-tight ${toneClass}`}>{value}</p>
    </div>
  );
}

function ChartTooltip({ active, payload }: TooltipPayload) {
  if (!active || !payload || payload.length === 0) return null;

  const first = payload[0]?.payload as ChartEntry | undefined;
  if (!first) return null;

  const planned = payload.find((item) => item.dataKey === "planned");
  const realized = payload.find((item) => item.dataKey === "realized");

  const plannedValue = typeof planned?.value === "number" ? planned.value : null;
  const realizedValue = typeof realized?.value === "number" ? realized.value : null;
  const difference =
    plannedValue !== null && realizedValue !== null
      ? Math.round(realizedValue - plannedValue)
      : null;

  return (
    <div className="rounded-lg border bg-background p-3 text-xs shadow-sm">
      <p className="font-semibold text-foreground">{formatFullDate(first.date)}</p>
      {plannedValue !== null ? (
        <p className="mt-1 text-muted-foreground">
          Planejado: <span className="font-semibold text-foreground">{Math.round(plannedValue)}%</span>
        </p>
      ) : null}
      {typeof first.plannedHours === "number" ? (
        <p className="text-muted-foreground">
          Horas acumuladas: <span className="font-semibold text-foreground">{first.plannedHours.toFixed(1)}</span>
        </p>
      ) : null}
      {realizedValue !== null ? (
        <p className="mt-1 text-muted-foreground">
          Realizado: <span className="font-semibold text-foreground">{Math.round(realizedValue)}%</span>
        </p>
      ) : null}
      {difference !== null ? (
        <p className="text-muted-foreground">
          Diferença: <span className="font-semibold text-foreground">{difference > 0 ? "+" : ""}{difference}%</span>
        </p>
      ) : null}
    </div>
  );
}

function clampPercent(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
}

export default function SCurve({
  planned,
  realizedSeries,
  realizedPercent,
  title,
  description,
  headerAside,
  className,
  chartHeight,
  deferRendering = false,
  metrics,
  showMetrics = true,
  showHeader = true,
  unstyled = false,
  visualEditingStorageKey,
}: SCurveProps) {
  const baseChartData = useMemo<ChartEntry[]>(() => {
    const map = new Map<string, ChartEntry>();

    const upsert = (date: string) => {
      const key = toDayIso(date);
      const existing = map.get(key);
      if (existing) return existing;
      const entry: ChartEntry = {
        date: key,
        dateLabel: formatShortDate(key),
        planned: null,
        realized: null,
        plannedHours: null,
      };
      map.set(key, entry);
      return entry;
    };

    planned.forEach((point) => {
      if (!point?.date) return;
      const entry = upsert(point.date);
      entry.planned = clampPercent(point.percent);
      entry.plannedHours = typeof point.hoursAccum === "number" ? point.hoursAccum : entry.plannedHours;
    });

    realizedSeries.forEach((point) => {
      if (!point?.date) return;
      const entry = upsert(point.date);
      entry.realized = clampPercent(point.percent);
    });

    const sorted = Array.from(map.values()).sort((a, b) => {
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });

    // Atualizar o último ponto com valor realized para usar realizedPercent
    if (typeof realizedPercent === "number" && Number.isFinite(realizedPercent)) {
      for (let i = sorted.length - 1; i >= 0; i--) {
        if (sorted[i].realized !== null) {
          sorted[i].realized = clampPercent(realizedPercent);
          break;
        }
      }
    }

    return sorted;
  }, [planned, realizedSeries, realizedPercent]);

  const [visualOverrides, setVisualOverrides] = useState<Record<string, number>>({});
  const [savedVisualOverrides, setSavedVisualOverrides] = useState<Record<string, number>>({});
  const [selectedPoint, setSelectedPoint] = useState<{ date: string; series: "planned" | "realized" } | null>(null);
  const [draggedPoint, setDraggedPoint] = useState<{ date: string; series: "planned" | "realized" } | null>(null);
  const chartWrapperRef = useRef<HTMLDivElement | null>(null);

  const overrideKey = useCallback((date: string, series: "planned" | "realized") => `${series}:${date}`, []);

  useEffect(() => {
    if (!visualEditingStorageKey || typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem(visualEditingStorageKey);
      const parsed = stored ? JSON.parse(stored) : {};
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const next: Record<string, number> = {};
        Object.entries(parsed).forEach(([key, value]) => {
          if (typeof value === "number" && Number.isFinite(value)) {
            const clamped = clampPercent(value);
            if (clamped !== null) next[key] = clamped;
          }
        });
        setVisualOverrides(next);
        setSavedVisualOverrides(next);
      }
    } catch {
      setVisualOverrides({});
      setSavedVisualOverrides({});
    }
  }, [visualEditingStorageKey]);

  const chartData = useMemo<ChartEntry[]>(() => {
    return baseChartData.map((entry) => ({
      ...entry,
      planned: visualOverrides[overrideKey(entry.date, "planned")] ?? entry.planned,
      realized: visualOverrides[overrideKey(entry.date, "realized")] ?? entry.realized,
    }));
  }, [baseChartData, overrideKey, visualOverrides]);

  const plannedTotal = useMemo(() => {
    const indicator = clampPercent(metrics?.plannedTotal);
    if (indicator !== null) {
      return indicator;
    }
    if (!planned.length) return 0;
    const last = planned[planned.length - 1];
    return clampPercent(last?.percent) ?? 0;
  }, [metrics?.plannedTotal, planned]);

  const plannedToToday = useMemo(() => {
    const indicator = clampPercent(metrics?.plannedToDate);
    if (indicator !== null) {
      return Math.round(indicator);
    }
    if (!planned.length) return 0;
    const today = new Date();
    const candidates = planned.filter((point) => {
      const date = new Date(point.date);
      if (Number.isNaN(date.getTime())) return false;
      return date.getTime() <= today.getTime();
    });
    if (!candidates.length) {
      const value = clampPercent(planned[0]?.percent) ?? 0;
      return Math.round(value);
    }
    const last = candidates[candidates.length - 1];
    const value = clampPercent(last?.percent) ?? 0;
    return Math.round(value);
  }, [metrics?.plannedToDate, planned]);

  const realisedLatest = useMemo(() => {
    const indicator = clampPercent(metrics?.realized);
    if (indicator !== null) {
      return indicator;
    }
    if (realizedSeries.length) {
      const last = realizedSeries[realizedSeries.length - 1];
      return clampPercent(last?.percent) ?? 0;
    }
    return clampPercent(realizedPercent) ?? 0;
  }, [metrics?.realized, realizedPercent, realizedSeries]);

  const delta = useMemo(() => {
    if (typeof metrics?.delta === "number" && Number.isFinite(metrics.delta)) {
      return metrics.delta;
    }
    return realisedLatest - plannedToToday;
  }, [metrics?.delta, plannedToToday, realisedLatest]);
  const deltaTone = delta >= -2 && delta <= 2 ? "neutral" : delta > 2 ? "positive" : "warning";

  const hasData = chartData.some((entry) => entry.planned !== null || entry.realized !== null);
  const hasRealizedData = chartData.some((entry) => entry.realized !== null);
  const [isClientReady, setIsClientReady] = useState(false);

  useEffect(() => {
    setIsClientReady(true);
  }, []);


  const resolvedTitle = title ?? "Curva S";
  const resolvedDescription =
    description ?? "Comparativo entre o avanço planejado e o realizado ao longo do tempo.";
  const resolvedChartHeight = chartHeight && Number.isFinite(chartHeight) && chartHeight > 0 ? chartHeight : 288;
  const containerClassName = cn(unstyled ? "space-y-4" : "card space-y-4 p-4", className);
  const axisColor = "hsl(var(--foreground))";
  const visualEditingEnabled = Boolean(visualEditingStorageKey);
  const selectedEntry = selectedPoint
    ? chartData.find((entry) => entry.date === selectedPoint.date)
    : null;
  const selectedValue = selectedEntry && selectedPoint ? selectedEntry[selectedPoint.series] : null;
  const hasUnsavedVisualChanges = JSON.stringify(visualOverrides) !== JSON.stringify(savedVisualOverrides);

  const setVisualPointValue = useCallback(
    (point: { date: string; series: "planned" | "realized" }, value: number) => {
      const clamped = clampPercent(value);
      if (clamped === null) return;
      setVisualOverrides((current) => ({ ...current, [overrideKey(point.date, point.series)]: clamped }));
    },
    [overrideKey],
  );

  const updateDraggedPoint = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      if (!draggedPoint || !chartWrapperRef.current) return;
      const rect = chartWrapperRef.current.getBoundingClientRect();
      const topPadding = 16;
      const bottomPadding = 36;
      const usableHeight = Math.max(1, rect.height - topPadding - bottomPadding);
      const relativeY = Math.min(usableHeight, Math.max(0, event.clientY - rect.top - topPadding));
      setVisualPointValue(draggedPoint, 100 - (relativeY / usableHeight) * 100);
    },
    [draggedPoint, setVisualPointValue],
  );

  const saveVisualChanges = () => {
    if (!visualEditingStorageKey || typeof window === "undefined") return;
    window.localStorage.setItem(visualEditingStorageKey, JSON.stringify(visualOverrides));
    setSavedVisualOverrides(visualOverrides);
  };

  const resetVisualChanges = () => {
    if (visualEditingStorageKey && typeof window !== "undefined") {
      window.localStorage.removeItem(visualEditingStorageKey);
    }
    setVisualOverrides({});
    setSavedVisualOverrides({});
    setSelectedPoint(null);
    setDraggedPoint(null);
  };

  const selectPoint = useCallback(
    (point: { date: string; series: "planned" | "realized" }) => {
      setSelectedPoint(point);
      setDraggedPoint(point);
    },
    [],
  );

  const selectPointFromChartEvent = useCallback(
    (event: unknown) => {
      if (!visualEditingEnabled) return;
      const chartEvent = event as { activePayload?: Array<{ dataKey?: string; value?: unknown; payload?: ChartEntry }> };
      const payloadItems = chartEvent.activePayload ?? [];
      const currentSeriesItem = selectedPoint
        ? payloadItems.find((item) => item.dataKey === selectedPoint.series && typeof item.value === "number")
        : null;
      const fallbackItem = payloadItems.find((item) => item.dataKey === "planned" && typeof item.value === "number")
        ?? payloadItems.find((item) => item.dataKey === "realized" && typeof item.value === "number");
      const item = currentSeriesItem ?? fallbackItem;
      if (!item?.payload || (item.dataKey !== "planned" && item.dataKey !== "realized")) return;
      selectPoint({ date: item.payload.date, series: item.dataKey });
    },
    [selectPoint, selectedPoint, visualEditingEnabled],
  );

  const renderEditableDot =
    (series: "planned" | "realized", color: string) =>
    (props: { cx?: number; cy?: number; payload?: ChartEntry; value?: number | null }) => {
      const { cx, cy, payload, value } = props;
      if (typeof cx !== "number" || typeof cy !== "number" || typeof value !== "number" || !payload) {
        return <g />;
      }
      if (!visualEditingEnabled) {
        return <circle cx={cx} cy={cy} r={DOT_RADIUS} stroke={color} fill={color} />;
      }
      const isSelected = selectedPoint?.date === payload.date && selectedPoint.series === series;
      const point = { date: payload.date, series };
      return (
        <g
          className="cursor-ns-resize outline-none"
          role="button"
          tabIndex={0}
          aria-label={`${series === "planned" ? "Planejado" : "Realizado"} em ${formatFullDate(payload.date)}: ${Math.round(value)}%`}
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            selectPoint(point);
          }}
          onClick={(event) => {
            event.stopPropagation();
            setSelectedPoint(point);
          }}
        >
          <circle cx={cx} cy={cy} r={14} fill="transparent" />
          <circle
            cx={cx}
            cy={cy}
            r={isSelected ? ACTIVE_DOT_RADIUS : DOT_RADIUS + 1}
            stroke={color}
            strokeWidth={isSelected ? 3 : 1}
            fill={color}
            pointerEvents="none"
          />
        </g>
      );
    };

  return (
    <div className={containerClassName}>
      {showHeader ? (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <h3 className="truncate text-base font-semibold">{resolvedTitle}</h3>
            <p className="text-xs text-muted-foreground">{resolvedDescription}</p>
          </div>
          {headerAside ? <div className="text-xs text-muted-foreground">{headerAside}</div> : null}
        </div>
      ) : null}

      {showMetrics ? (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Planejado (total)" value={`${Math.round(plannedTotal)}%`} />
          <MetricCard label="Planejado até hoje" value={`${plannedToToday}%`} />
          <MetricCard label="Realizado" value={`${Math.round(realisedLatest)}%`} tone="positive" />
          <MetricCard
            label="Diferença"
            value={`${delta > 0 ? "+" : ""}${Math.round(delta)}%`}
            tone={deltaTone === "positive" ? "positive" : deltaTone === "warning" ? "warning" : "neutral"}
          />
        </div>
      ) : null}

      {visualEditingEnabled ? (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-dashed bg-background/70 p-3 text-xs print:hidden">
          <div className="min-w-52 flex-1 text-muted-foreground">
            Arraste um ponto para cima/baixo ou selecione e digite a porcentagem. As mudanças são apenas visuais.
          </div>
          {selectedPoint ? (
            <label className="flex items-center gap-2 font-medium text-foreground">
              {selectedPoint.series === "planned" ? "Planejado" : "Realizado"} ({formatShortDate(selectedPoint.date)})
              <input
                className="h-9 w-20 rounded-md border bg-background px-2 text-right"
                type="number"
                min={0}
                max={100}
                step={1}
                value={typeof selectedValue === "number" ? Math.round(selectedValue) : ""}
                onChange={(event) => setVisualPointValue(selectedPoint, Number(event.target.value))}
              />
              %
            </label>
          ) : null}
          <button className="btn btn-secondary h-9" type="button" onClick={saveVisualChanges} disabled={!hasUnsavedVisualChanges}>
            Salvar visualização
          </button>
          <button className="btn btn-secondary h-9" type="button" onClick={resetVisualChanges}>
            Resetar original
          </button>
        </div>
      ) : null}

      {hasData ? (
        isClientReady ? (
          <div
            ref={chartWrapperRef}
            className={cn("w-full scurve-container", draggedPoint ? "select-none" : null)}
            style={{ height: resolvedChartHeight }}
            onMouseMove={updateDraggedPoint}
            onMouseUp={() => setDraggedPoint(null)}
            onMouseLeave={() => setDraggedPoint(null)}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ left: 44, right: 16, top: 28, bottom: 12 }}
                style={{ background: "transparent" }}
                onMouseDown={selectPointFromChartEvent}
              >
                {/* Removendo gridlines do gráfico */}
                <CartesianGrid vertical={false} horizontal={false} />
                <XAxis
                  dataKey="dateLabel"
                  stroke={axisColor}
                  tick={{ fontSize: 12, fill: axisColor }}
                  tickLine={{ stroke: axisColor, strokeWidth: 1.25 }}
                  axisLine={{ stroke: axisColor, strokeWidth: 1.5 }}
                />
                <YAxis
                  domain={[0, 100]}
                  ticks={[0, 25, 50, 75, 100]}
                  tick={{ fontSize: 11, fill: axisColor }}
                  width={38}
                  stroke={axisColor}
                  tickLine={{ stroke: axisColor, strokeWidth: 1.25 }}
                  axisLine={{ stroke: axisColor, strokeWidth: 1.5 }}
                  tickMargin={4}
                  allowDecimals={false}
                  tickFormatter={(value) => `${value}%`}
                />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, color: axisColor }} />
                <Line
                  type="monotone"
                  name="Planejado"
                  dataKey="planned"
                  stroke={PLANNED_COLOR} // cor da série Planejado alinhada ao modelo João
                  strokeWidth={LINE_STROKE_WIDTH}
                  dot={renderEditableDot("planned", PLANNED_COLOR)}
                  activeDot={{ r: ACTIVE_DOT_RADIUS, stroke: PLANNED_COLOR, fill: PLANNED_COLOR }}
                  strokeLinecap="round"
                  isAnimationActive={false}
                >
                  <LabelList
                    dataKey="planned"
                    position="top"
                    formatter={(value: unknown) => (typeof value === "number" ? `${Math.round(value)}%` : "")}
                    className="text-[11px] font-semibold drop-shadow-sm"
                    fill={axisColor}
                  />
                </Line>
                {hasRealizedData ? (
                  <Line
                    type="monotone"
                    name="Realizado"
                    dataKey="realized"
                    stroke={REALIZED_COLOR} // cor da série Realizado alinhada ao modelo João
                    strokeWidth={LINE_STROKE_WIDTH}
                    dot={renderEditableDot("realized", REALIZED_COLOR)}
                    activeDot={{ r: ACTIVE_DOT_RADIUS, stroke: REALIZED_COLOR, fill: REALIZED_COLOR }}
                    strokeLinecap="round"
                    isAnimationActive={false}
                  >
                    <LabelList
                      dataKey="realized"
                      position="top"
                      formatter={(value: unknown) => (typeof value === "number" ? `${Math.round(value)}%` : "")}
                      className="text-[11px] font-semibold drop-shadow-sm"
                      fill={axisColor}
                    />
                  </Line>
                ) : null}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex h-72 w-full items-center justify-center rounded-xl border border-dashed border-muted-foreground/40 bg-muted/20 text-xs text-muted-foreground">
            Preparando gráfico…
          </div>
        )
      ) : (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Dados insuficientes para montar a curva S.
        </div>
      )}
    </div>
  );
}
