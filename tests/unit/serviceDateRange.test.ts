import { describe, expect, it } from "vitest";

import { serviceIntersectsDateRange } from "@/lib/serviceDateRange";

describe("serviceIntersectsDateRange", () => {
  const rangeStart = "2026-03-10";
  const rangeEnd = "2026-03-20";

  it("inclui serviços que se sobrepõem ao período, inclusive nas bordas", () => {
    expect(
      serviceIntersectsDateRange(
        { plannedStart: "2026-03-01", plannedEnd: "2026-03-10" },
        rangeStart,
        rangeEnd,
      ),
    ).toBe(true);
    expect(
      serviceIntersectsDateRange(
        { plannedStart: "2026-03-20", plannedEnd: "2026-03-25" },
        rangeStart,
        rangeEnd,
      ),
    ).toBe(true);
  });

  it("exclui serviços fora do período ou sem datas", () => {
    expect(
      serviceIntersectsDateRange(
        { inicioPrevisto: "2026-03-01", fimPrevisto: "2026-03-09" },
        rangeStart,
        rangeEnd,
      ),
    ).toBe(false);
    expect(serviceIntersectsDateRange({}, rangeStart, rangeEnd)).toBe(false);
  });

  it("considera uma data isolada como um único dia", () => {
    expect(serviceIntersectsDateRange({ dataInicio: "12/03/2026" }, rangeStart, rangeEnd)).toBe(true);
    expect(serviceIntersectsDateRange({ dataFim: "2026-03-21" }, rangeStart, rangeEnd)).toBe(false);
  });

  it("aceita datas do Firestore em formato Timestamp", () => {
    const timestamp = {
      toMillis: () => Date.UTC(2026, 2, 15),
    };
    expect(
      serviceIntersectsDateRange({ plannedStart: timestamp, plannedEnd: timestamp }, rangeStart, rangeEnd),
    ).toBe(true);
  });

  it("rejeita períodos inválidos ou invertidos", () => {
    expect(serviceIntersectsDateRange({ plannedStart: rangeStart }, "2026-03-30", rangeEnd)).toBe(false);
    expect(serviceIntersectsDateRange({ plannedStart: rangeStart }, "invalida", rangeEnd)).toBe(false);
  });
});
