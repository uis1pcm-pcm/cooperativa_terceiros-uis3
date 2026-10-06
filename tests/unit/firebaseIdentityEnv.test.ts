import { afterEach, describe, expect, it, vi } from "vitest";

function createToken(payload: Record<string, unknown>) {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.signature`;
}

describe("firebase identity environment handling", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  afterEach(() => {
    process.env = { ...originalEnv };
    global.fetch = originalFetch;
    vi.resetModules();
  });

  it("treats missing public API key as not configured", async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    delete process.env.FIREBASE_API_KEY;

    const mod = await import("@/lib/firebaseIdentity");
    expect(mod.isIdentityToolkitConfigured()).toBe(false);
  });

  it("ignores placeholder NEXT_PUBLIC values", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "missing-next-public-firebase-api-key";

    const mod = await import("@/lib/firebaseIdentity");
    expect(mod.isIdentityToolkitConfigured()).toBe(false);
  });

  it("avoids calling fetch when identity toolkit is unavailable", async () => {
    delete process.env.NEXT_PUBLIC_FIREBASE_API_KEY;
    delete process.env.FIREBASE_API_KEY;
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-project";

    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as typeof global.fetch;

    const nowSeconds = Math.floor(Date.now() / 1000);
    const mod = await import("@/lib/firebaseIdentity");
    const token = createToken({ exp: nowSeconds + 600, iat: nowSeconds });
    const result = await mod.verifyFirebaseIdToken(token);

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("calls Identity Toolkit when configured", async () => {
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY = "demo-key";
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = "demo-project";

    const nowSeconds = Math.floor(Date.now() / 1000);
    const token = createToken({
      exp: nowSeconds + 600,
      iat: nowSeconds,
      aud: "demo-project",
    });

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        users: [
          {
            localId: "uid-1",
            email: "user@example.com",
            emailVerified: true,
            validSince: String(nowSeconds - 10),
          },
        ],
      }),
    });
    global.fetch = fetchSpy as typeof global.fetch;

    const mod = await import("@/lib/firebaseIdentity");
    const result = await mod.verifyFirebaseIdToken(token);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        uid: "uid-1",
        email: "user@example.com",
        emailVerified: true,
      }),
    );
  });
});
