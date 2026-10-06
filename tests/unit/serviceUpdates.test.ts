import { describe, expect, it } from "vitest";

import { filterUpdatesWithRelevantContent } from "@/app/(pcm)/servicos/[id]/shared";
import { formatCanonicalProgressLabel } from "@/lib/serviceUpdates";
import type { ServiceUpdate } from "@/lib/types";

const baseUpdate: ServiceUpdate = {
  id: "1",
  percent: 10,
  createdAt: Date.parse("2025-11-28T11:14:00Z"),
};

describe("filterUpdatesWithRelevantContent", () => {
  it("removes updates that only carry date/time/percentual", () => {
    const updates: ServiceUpdate[] = [
      baseUpdate,
      { ...baseUpdate, id: "2", description: "Dia cheio" },
    ];

    const filtered = filterUpdatesWithRelevantContent(updates);

    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("2");
  });

  it("returns an empty list when there is only an empty update", () => {
    const filtered = filterUpdatesWithRelevantContent([baseUpdate]);
    expect(filtered).toHaveLength(0);
  });

  it("keeps updates that include any relevant detail", () => {
    const updates: ServiceUpdate[] = [
      { ...baseUpdate, id: "3", resources: [{ name: "Retroescavadeira" }] },
      { ...baseUpdate, id: "4", workforce: [{ role: "Operador", quantity: 2 }] },
      { ...baseUpdate, id: "5", shiftConditions: [{ shift: "manha" }] },
    ];

    const filtered = filterUpdatesWithRelevantContent(updates);

    expect(filtered.map((update) => update.id)).toEqual(["3", "4", "5"]);
  });
});

describe("formatCanonicalProgressLabel", () => {
  it("exibe o progresso consolidado em vez do snapshot do lançamento", () => {
    expect(formatCanonicalProgressLabel(35)).toBe("35%");
    expect(formatCanonicalProgressLabel(35.6)).toBe("36%");
  });

  it("limita valores inválidos ou fora da faixa", () => {
    expect(formatCanonicalProgressLabel(Number.NaN)).toBe("0%");
    expect(formatCanonicalProgressLabel(-10)).toBe("0%");
    expect(formatCanonicalProgressLabel(120)).toBe("100%");
  });
});
