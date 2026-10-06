const PROGRESS_FIELDS = [
  "andamento",
  "percentualRealAtual",
  "realPercentSnapshot",
  "manualPercent",
  "realPercent",
  "progress",
  "percent",
] as const;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function resolveCurrentProgress(data: Record<string, unknown>): number {
  const status = String(data.displayStatus ?? data.status ?? "").trim().toLowerCase();
  const canonicalProgress = PROGRESS_FIELDS
    .map((field) => toFiniteNumber(data[field]))
    .find((value): value is number => value !== null);

  if (status === "pendente" && (canonicalProgress === undefined || canonicalProgress >= 100)) {
    const reopenedFields = ["previousProgress", "progressBeforeConclusion", "previousPercent"] as const;
    for (const field of reopenedFields) {
      const value = toFiniteNumber(data[field]);
      if (value !== null && clampPercent(value) < 100) return clampPercent(value);
    }
  }

  // Os documentos legados podem conter campos antigos ainda em 100% depois de
  // uma correção para 95%. Use a mesma precedência das telas em vez do maior
  // número, que transformava esse resíduo em um bloqueio permanente de RDOs.
  if (canonicalProgress !== undefined) return clampPercent(canonicalProgress);
  return 0;
}

