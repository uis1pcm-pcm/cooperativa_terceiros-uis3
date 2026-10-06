import { beforeEach, describe, expect, it, vi } from "vitest";

const { computeProgressHistoryMock } = vi.hoisted(() => ({
  computeProgressHistoryMock: vi.fn(),
}));

vi.mock("@/lib/progressHistoryServer", () => ({
  computeProgressHistory: computeProgressHistoryMock,
}));

import { curvaRealizadaPacote } from "@/lib/curvaS";

describe("curvaRealizadaPacote", () => {
  beforeEach(() => {
    computeProgressHistoryMock.mockReset();
  });

  it("preserva o percentual de um lançamento anterior ao início do gráfico no primeiro dia exibido", async () => {
    computeProgressHistoryMock.mockResolvedValue({
      byDay: new Map([
        ["2026-08-03", 30],
        ["2026-08-05", 60],
      ]),
      lastExplicitTimestamp: new Date("2026-08-05T00:00:00.000Z").getTime(),
    });

    const curve = await curvaRealizadaPacote(
      [{ id: "service-1", hours: 10 }],
      new Date("2026-08-05T00:00:00.000Z"),
      new Date("2026-08-10T00:00:00.000Z"),
    );

    expect(curve).toEqual([
      { d: "2026-08-05", pct: 30 },
      { d: "2026-08-06", pct: 60 },
      { d: "2026-08-07", pct: 60 },
      { d: "2026-08-08", pct: 60 },
      { d: "2026-08-09", pct: 60 },
      { d: "2026-08-10", pct: 60 },
    ]);
  });

});
