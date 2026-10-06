import { describe, expect, it } from "vitest";

import { isConnectionResetError } from "@/lib/networkErrors";

describe("isConnectionResetError", () => {
  it("detects classic ERR_CONNECTION_RESET strings", () => {
    expect(isConnectionResetError("ERR_CONNECTION_RESET"));
    expect(isConnectionResetError(new Error("boom ERR_CONNECTION_RESET boom"))).toBe(true);
  });

  it("detects ECONNRESET codes", () => {
    expect(isConnectionResetError({ code: "ECONNRESET" })).toBe(true);
  });

  it("detects connection closed messages", () => {
    expect(isConnectionResetError("Connection closed.")).toBe(true);
    expect(isConnectionResetError(new Error("The connection was closed by the server"))).toBe(true);
  });

  it("returns false for unrelated errors", () => {
    expect(isConnectionResetError("Timeout")).toBe(false);
    expect(isConnectionResetError(new Error("Permission denied"))).toBe(false);
  });
});
