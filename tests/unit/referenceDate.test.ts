import { describe, expect, it } from "vitest";

import { formatReferenceLabel, resolveReferenceDate, startOfDayInTimeZone } from "@/lib/referenceDate";

describe("reference date utilities", () => {
  it("normalizes arbitrary instants to the start of day in Sao Paulo", () => {
    const instant = new Date("2025-11-24T12:34:56Z");
    const normalized = startOfDayInTimeZone(instant);
    expect(normalized.toISOString().startsWith("2025-11-24T03:00:00.000Z")).toBe(true);
  });

  it("parses query-friendly input and preserves the original string", () => {
    const result = resolveReferenceDate("2025-11-24");
    expect(result.inputValue).toBe("2025-11-24");
    expect(formatReferenceLabel(result.date)).toBe("24/11/2025");
  });

  it("keeps the selected calendar day when interpreting user input", () => {
    const { date } = resolveReferenceDate("2025-11-23");
    expect(date.toISOString().startsWith("2025-11-23T03:00:00.000Z")).toBe(true);
    expect(formatReferenceLabel(date)).toBe("23/11/2025");
  });
});
