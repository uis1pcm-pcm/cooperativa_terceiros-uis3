import { describe, expect, it } from "vitest";
import { buildServiceSearchTokens, normalizeServiceSearch, serviceSearchMatches } from "../../src/lib/serviceSearch";

describe("service search", () => {
  it("normalizes accents, case and whitespace", () => expect(normalizeServiceSearch("  MÓTOR   Elétrico ")).toBe("motor eletrico"));
  it("builds useful identifiers and controlled trigrams", () => {
    const tokens = buildServiceSearchTokens("svc-1", { os: "OS-123", equipmentName: "Motor" });
    expect(tokens).toEqual(expect.arrayContaining(["123", "motor", "mot", "oto", "tor"]));
  });
  it("preserves substring matching across historical aliases", () => expect(serviceSearchMatches("x", { equipamento: "Motor elétrico" }, "ELETR")).toBe(true));
});
