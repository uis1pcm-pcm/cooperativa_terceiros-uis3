import { describe, expect, it } from "vitest";

import { parseDayFirstDateStringToUtcDate, parsePortugueseDateStringToUtcDate } from "@/lib/dateParsing";

describe("dateParsing", () => {
  it("parses dd/MM/yyyy as UTC date-only", () => {
    const date = parseDayFirstDateStringToUtcDate("17/11/2025");
    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe("2025-11-17T00:00:00.000Z");
  });

  it("parses dd-MM-yy using 2000/1900 pivot (<50 => 20xx)", () => {
    expect(parseDayFirstDateStringToUtcDate("17-11-25")?.toISOString()).toBe(
      "2025-11-17T00:00:00.000Z",
    );
    expect(parseDayFirstDateStringToUtcDate("17-11-75")?.toISOString()).toBe(
      "1975-11-17T00:00:00.000Z",
    );
  });

  it("rejects impossible dates", () => {
    expect(parseDayFirstDateStringToUtcDate("31/02/2025")).toBeNull();
    expect(parseDayFirstDateStringToUtcDate("99/99/2025")).toBeNull();
  });

  it("parses Portuguese month names with optional time fragments", () => {
    const date = parsePortugueseDateStringToUtcDate("20 de novembro de 2025 às 09:00:00 UTC-3");
    expect(date?.toISOString()).toBe("2025-11-20T00:00:00.000Z");
  });
});
