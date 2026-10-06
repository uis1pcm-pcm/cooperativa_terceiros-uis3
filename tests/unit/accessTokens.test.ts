import { describe, expect, it } from "vitest";

import { isCanonicalTokenActive } from "../../src/lib/accessTokenState";

describe("isTokenActive", () => {
  const now = 2_000;

  it("accepts an active unexpired token", () => {
    expect(isCanonicalTokenActive({ active: true, status: "active", expiresAtMillis: 3_000 }, now)).toBe(true);
  });

  it("rejects revoked, inactive and expired tokens", () => {
    expect(isCanonicalTokenActive({ revoked: true, status: "active" }, now)).toBe(false);
    expect(isCanonicalTokenActive({ active: false, status: "active" }, now)).toBe(false);
    expect(isCanonicalTokenActive({ status: "revoked" }, now)).toBe(false);
    expect(isCanonicalTokenActive({ status: "active", expiresAtMillis: 1_999 }, now)).toBe(false);
  });
});
