export type ChecklistWeightInput = Array<{ id?: string | null; itemId?: string | null; weight?: number | null; peso?: number | null }>;

export type ProgressEvent = {
  timestamp: number;
  /** Momento da última edição, usado para desempatar lançamentos do mesmo instante operacional. */
  revisionTimestamp?: number | null;
  /** Fonte usada apenas para desempatar cópias idênticas do mesmo lançamento. */
  sourcePriority?: number;
  percent?: number | null;
  items?: Array<{ id: string; pct: number }>;
  explicitDate?: boolean;
};

function readFinitePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normaliseId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value || null;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

export function buildChecklistWeightMap(input: ChecklistWeightInput) {
  const weights = new Map<string, number>();
  let totalWeight = 0;

  input.forEach((entry) => {
    const id = normaliseId(entry.id ?? entry.itemId);
    if (!id) return;
    const rawWeight = entry.weight ?? entry.peso;
    const weight = typeof rawWeight === "number" && Number.isFinite(rawWeight) ? clampPercent(rawWeight) : 0;
    weights.set(id, weight);
    totalWeight += weight;
  });

  return { weights, totalWeight };
}

function computeFromItems(
  latestPerItem: Map<string, number>,
  weights: Map<string, number>,
  totalWeight: number,
): number {
  if (weights.size === 0 || totalWeight <= 0) {
    if (!latestPerItem.size) return 0;
    let sum = 0;
    latestPerItem.forEach((value) => {
      sum += value;
    });
    return clampPercent(sum / latestPerItem.size);
  }

  let weighted = 0;
  weights.forEach((weight, id) => {
    const pct = latestPerItem.get(id) ?? 0;
    weighted += (weight * pct) / totalWeight;
  });
  return clampPercent(weighted);
}

export function computeProgressFromEvents(
  events: ProgressEvent[],
  options?: { weights?: Map<string, number>; totalWeight?: number },
) {
  const weights = options?.weights ?? new Map<string, number>();
  const totalWeight = options?.totalWeight ?? 0;
  const sorted = events
    .filter((event) => Number.isFinite(event.timestamp))
    .sort((a, b) => {
      const chronological = a.timestamp - b.timestamp;
      if (chronological !== 0) return chronological;

      // Um RDO pode existir nas coleções atual e legada com a mesma data. Ao
      // editar uma dessas cópias, a revisão mais nova precisa prevalecer; caso
      // contrário, o espelho antigo de 100% volta a sobrescrever os 95%.
      const revision = (a.revisionTimestamp ?? a.timestamp) - (b.revisionTimestamp ?? b.timestamp);
      if (revision !== 0) return revision;
      return (a.sourcePriority ?? 0) - (b.sourcePriority ?? 0);
    });

  const latestPerItem = new Map<string, number>();
  const byDay = new Map<string, number>();
  let currentPercent = 0;
  let lastTimestamp: number | null = null;
  let lastExplicitTimestamp: number | null = null;
  const hasAnyExplicitDate = sorted.some((event) => event.explicitDate === true);

  sorted.forEach((event) => {
    lastTimestamp = event.timestamp;
    if (event.explicitDate) {
      lastExplicitTimestamp = event.timestamp;
    }

    const explicitPercent = readFinitePercent(event.percent);
    if (explicitPercent !== null) {
      currentPercent = clampPercent(explicitPercent);
    }

    if (Array.isArray(event.items) && event.items.length > 0) {
      event.items.forEach((item) => {
        const id = normaliseId(item.id);
        if (!id) return;
        const pct = clampPercent(typeof item.pct === "number" ? item.pct : Number(item.pct));
        latestPerItem.set(id, pct);
      });
      if (latestPerItem.size > 0) {
        currentPercent = computeFromItems(latestPerItem, weights, totalWeight);
      }
    }

    if (typeof event.percent === "number" && Number.isFinite(event.percent)) {
      currentPercent = clampPercent(event.percent);
    }

    // Regra da curva diária:
    // - quando houver pelo menos um lançamento com data explícita (reportDate/date),
    //   apenas esses lançamentos entram no eixo diário;
    // - sem datas explícitas (legado), usa o timestamp do evento como fallback.
    if (!hasAnyExplicitDate || event.explicitDate === true) {
      const date = new Date(event.timestamp);
      const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      const iso = day.toISOString().slice(0, 10);
      byDay.set(iso, clampPercent(currentPercent));
    }
  });

  // Preservar o valor exato sem arredondamento desnecessário que pode alterar o valor digitado
  // Apenas garantir que está no range 0-100
  const finalPercent = clampPercent(currentPercent);
  return { currentPercent: finalPercent, lastTimestamp, lastExplicitTimestamp, byDay };
}
