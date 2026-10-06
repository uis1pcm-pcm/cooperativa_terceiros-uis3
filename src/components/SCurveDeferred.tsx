"use client";

import { useEffect, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";

import type { SCurveProps } from "./SCurve";

const LazySCurve = dynamic(() => import("./SCurve"), {
  ssr: false,
});

export type SCurveDeferredProps = SCurveProps & {
  fallback?: ReactNode;
};

export default function SCurveDeferred({ fallback, chartHeight, ...props }: SCurveDeferredProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const resolvedHeight =
    typeof chartHeight === "number" && Number.isFinite(chartHeight) && chartHeight > 0 ? chartHeight : 288;
  const defaultFallback = (
    <div
      className="flex w-full items-center justify-center rounded-xl border border-dashed bg-muted/40"
      style={{ minHeight: resolvedHeight }}
    >
      <span className="text-sm text-muted-foreground">Carregando gráfico...</span>
    </div>
  );

  if (!mounted) {
    if (fallback) {
      return <>{fallback}</>;
    }
    return defaultFallback;
  }

  return <LazySCurve {...props} chartHeight={chartHeight} />;
}
