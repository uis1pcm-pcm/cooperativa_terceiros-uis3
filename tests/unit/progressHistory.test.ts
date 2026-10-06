import { describe, expect, it } from "vitest";

import { computeProgressFromEvents } from "@/lib/progressHistory";

describe("progress history", () => {
  it("prioriza a revisão mais recente quando há cópias do mesmo lançamento", () => {
    const timestamp = Date.parse("2026-09-16T12:00:00Z");
    const result = computeProgressFromEvents([
      { timestamp, percent: 95, revisionTimestamp: timestamp + 10_000 },
      { timestamp, percent: 100, revisionTimestamp: timestamp },
    ]);

    expect(result.currentPercent).toBe(95);
  });

  it("prioriza a cópia canônica quando cópias do mesmo lançamento empatam", () => {
    const timestamp = Date.parse("2026-09-16T12:00:00Z");
    const result = computeProgressFromEvents([
      { timestamp, percent: 100, sourcePriority: 0 },
      { timestamp, percent: 70, sourcePriority: 1 },
    ]);

    expect(result.currentPercent).toBe(70);
  });
});
