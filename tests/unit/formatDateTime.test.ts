import { describe, expect, it } from "vitest";

import { formatDate, formatDateTime } from "@/lib/formatDateTime";

describe("formatDateTime helpers", () => {
  const TIME_ZONE = "America/Sao_Paulo";

  it("keeps date-only timestamps stable regardless of timezone", () => {
    const millis = Date.UTC(2024, 5, 17); // 17/06/2024 00:00 UTC
    expect(formatDate(millis, { timeZone: TIME_ZONE })).toBe("17/06/2024");
    expect(formatDateTime(millis, { timeZone: TIME_ZONE })).toBe("17/06/2024 00:00");
  });

  it("supports ISO date-only strings without shifting the day", () => {
    expect(formatDate("2024-06-17", { timeZone: TIME_ZONE })).toBe("17/06/2024");
    expect(formatDate("17/06/2024", { timeZone: TIME_ZONE })).toBe("17/06/2024");
    expect(formatDate("2024-06-17T00:00:00-03:00", { timeZone: TIME_ZONE })).toBe("17/06/2024");
  });

  it("continues to apply timezone offsets for actual timestamps", () => {
    const millis = Date.UTC(2024, 5, 17, 1, 0); // 17/06 01:00 UTC -> 16/06 22:00 Sao Paulo
    expect(formatDate(millis, { timeZone: TIME_ZONE })).toBe("16/06/2024");
    expect(formatDateTime(millis, { timeZone: TIME_ZONE })).toBe("16/06/2024 22:00");
  });
});
