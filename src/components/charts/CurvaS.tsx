import type { CSSProperties } from "react";

import { formatDayMonth, formatLongDate } from "@/lib/formatDateTime";
import { ACTIVE_DOT_RADIUS, DOT_RADIUS, LINE_STROKE_WIDTH, PLANNED_COLOR, REALIZED_COLOR } from "./colors";

type CurvePoint = { d: string; pct: number };

export type CurvaSProps = {
  planned: CurvePoint[];
  actual: CurvePoint[];
};

const clampPercent = (value: number) => {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
};

const roundTwo = (value: number) => Math.round(value * 100) / 100;

const UTC_TIME_ZONE = "UTC";

const getDateLabel = (iso: string) => {
  const value = iso.includes("T") ? iso : `${iso}T00:00:00Z`;
  return formatDayMonth(value, { timeZone: UTC_TIME_ZONE, fallback: iso }) || iso;
};

const getLongDateLabel = (iso: string) => {
  const value = iso.includes("T") ? iso : `${iso}T00:00:00Z`;
  return formatLongDate(value, { timeZone: UTC_TIME_ZONE, fallback: iso }) || iso;
};

type SeriesData = {
  path: string;
  points: Array<{ x: number; y: number; value: number; label: string }>;
};

const computeSeries = (
  points: CurvePoint[],
  xPositions: Map<string, number>,
  yForPercent: (value: number) => number,
): SeriesData => {
  const sorted = [...points].sort((a, b) => a.d.localeCompare(b.d));
  const coords = sorted
    .map((point) => {
      const x = xPositions.get(point.d);
      if (typeof x !== "number") return null;
      const pct = clampPercent(point.pct);
      return {
        x,
        y: yForPercent(pct),
        value: roundTwo(pct),
        label: point.d,
      };
    })
    .filter((point): point is NonNullable<typeof point> => Boolean(point));

  const path = coords
    .map((coord, index) => `${index === 0 ? "M" : "L"}${coord.x} ${coord.y}`)
    .join(" ");

  return { path, points: coords };
};

export default function CurvaS({ planned, actual }: CurvaSProps) {
  const hasData = planned.length > 0 || actual.length > 0;

  if (!hasData) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">
        Sem dados suficientes para gerar o gráfico.
      </div>
    );
  }

  const datesSet = new Set<string>();
  planned.forEach((point) => datesSet.add(point.d));
  actual.forEach((point) => datesSet.add(point.d));

  const dates = Array.from(datesSet).sort((a, b) => a.localeCompare(b));
  if (!dates.length) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border border-dashed border-muted-foreground/40 bg-muted/20 px-4 py-12 text-center text-sm text-muted-foreground">
        Sem dados suficientes para gerar o gráfico.
      </div>
    );
  }

  const width = 1200;
  const height = 600;
  const padding = { top: 24, right: 32, bottom: 56, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const xPositions = new Map<string, number>();
  dates.forEach((date, index) => {
    const x =
      dates.length > 1
        ? padding.left + (index / (dates.length - 1)) * plotWidth
        : padding.left + plotWidth / 2;
    xPositions.set(date, x);
  });

  const yForPercent = (value: number) =>
    padding.top + ((100 - clampPercent(value)) / 100) * plotHeight;

  const plannedSeries = computeSeries(planned, xPositions, yForPercent);
  const actualSeries = computeSeries(actual, xPositions, yForPercent);

  // Build quick lookup maps so each dot can expose the daily delta between real and planned.
  const plannedPercentByDate = new Map(plannedSeries.points.map((point) => [point.label, point.value]));
  const actualPercentByDate = new Map(actualSeries.points.map((point) => [point.label, point.value]));
  const showXAxisLabels = dates.length <= 8 ? dates : dates.filter((_, index) => index % 2 === 0);

  const legendItems: Array<{ label: string; color: string }> = [
    { label: "Planejado", color: PLANNED_COLOR },
    { label: "Realizado", color: REALIZED_COLOR },
  ];

  const seriesWithColor = [
    { series: plannedSeries, color: PLANNED_COLOR },
    { series: actualSeries, color: REALIZED_COLOR },
  ];

  return (
    <div className="space-y-4">
      <svg
        role="img"
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        style={{ maxWidth: "100%" } as CSSProperties}
        aria-label="Curva S planejado versus realizado"
      >
        <rect
          x={padding.left}
          y={padding.top}
          width={plotWidth}
          height={plotHeight}
          fill="none"
          stroke="#d1d5db"
          strokeWidth={1}
        />

        <line
          x1={padding.left}
          y1={padding.top + plotHeight}
          x2={padding.left + plotWidth}
          y2={padding.top + plotHeight}
          stroke="#111827"
          strokeWidth={1.5}
        />

        {/* Linhas de grade horizontais e labels de porcentagem */}
        {[0, 25, 50, 75, 100].map((percent) => {
          const y = yForPercent(percent);
          return (
            <g key={percent}>
              <line
                x1={padding.left}
                y1={y}
                x2={padding.left + plotWidth}
                y2={y}
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray="2,2"
              />
              <text
                x={padding.left - 8}
                y={y + 4}
                textAnchor="end"
                fontSize={12}
                fill="#4b5563"
                dominantBaseline="middle"
              >
                {percent === 0 ? "0" : `${percent}%`}
              </text>
            </g>
          );
        })}

        {showXAxisLabels.map((date) => {
          const x = xPositions.get(date);
          if (typeof x !== "number") return null;
          return (
            <text
              key={date}
              x={x}
              y={padding.top + plotHeight + 24}
              textAnchor="middle"
              fontSize={12}
              fill="#4b5563"
            >
              {getDateLabel(date)}
            </text>
          );
        })}

        {seriesWithColor.map(({ series, color }) => (
          series.path ? (
            <path
              key={color}
              d={series.path}
              fill="none"
              stroke={color}
              strokeWidth={LINE_STROKE_WIDTH}
              strokeLinecap="round"
            />
          ) : null
        ))}

        {seriesWithColor.map(({ series, color }, seriesIndex) =>
          series.points.map((point, pointIndex) => {
            const plannedValue = plannedPercentByDate.get(point.label);
            const actualValue = actualPercentByDate.get(point.label);
            const hasDifference = plannedValue !== undefined && actualValue !== undefined;

            const dailyDifference = hasDifference ? roundTwo(actualValue - plannedValue) : null;

            const tooltipLines = [
              getLongDateLabel(point.label),
              plannedValue !== undefined ? `Planejado: ${plannedValue}%` : null,
              actualValue !== undefined ? `Realizado: ${actualValue}%` : null,
              hasDifference && dailyDifference !== null
                ? `Diferença: ${dailyDifference > 0 ? "+" : ""}${dailyDifference}%`
                : null,
            ].filter((line): line is string => Boolean(line));

            return (
              <g key={`${seriesIndex}-${point.label}-${pointIndex}`}>
                <circle
                  cx={point.x}
                  cy={point.y}
                  r={Math.max(DOT_RADIUS, ACTIVE_DOT_RADIUS - 1)}
                  fill={color} // marcador com a mesma cor da série
                  strokeWidth={Math.max(2, LINE_STROKE_WIDTH - 0.5)}
                  stroke={color}
                />
                <title>{tooltipLines.join("\n")}</title>
              </g>
            );
          }),
        )}
      </svg>

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        {legendItems.map((item) => (
          <div key={item.label} className="flex items-center gap-2">
            <span
              className="h-2 w-4 rounded-sm"
              style={{
                background: item.color,
              }}
            />
            <span className="font-medium text-foreground">{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
