import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;
type PcmSessionPayload = {
  email: string;
  expiresAt: number;
};

async function ensureStore(provided?: CookieStore): Promise<CookieStore> {
  if (provided) {
    return provided;
  }
  return cookies();
}

export const PCM_SESSION_COOKIE_NAME = "pcm_session";
export const PCM_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

const PCM_LOGIN_EMAIL = "pcm1.uis3@lar.ind.br";
const PCM_LOGIN_PASSWORD = "pcm1.uis3";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sessionSecret(): string | null {
  return (
    process.env.PCM_SESSION_SECRET ||
    process.env.FIREBASE_PRIVATE_KEY ||
    process.env.FIREBASE_ADMIN_PRIVATE_KEY ||
    process.env.FIREBASE_SERVICE_ACCOUNT_BASE64 ||
    process.env.FIREBASE_ADMIN_JSON_BASE64 ||
    null
  );
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function verifyPcmCredentials(email: unknown, password: unknown): boolean {
  return (
    typeof email === "string" &&
    typeof password === "string" &&
    safeEqual(email.trim().toLowerCase(), PCM_LOGIN_EMAIL) &&
    safeEqual(password, PCM_LOGIN_PASSWORD)
  );
}

export function createPcmSessionToken(): string {
  const secret = sessionSecret();
  if (!secret) {
    throw new Error("PCM_SESSION_SECRET_NOT_CONFIGURED");
  }
  const payload: PcmSessionPayload = {
    email: PCM_LOGIN_EMAIL,
    expiresAt: Math.floor(Date.now() / 1000) + PCM_SESSION_MAX_AGE_SECONDS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encodedPayload}.${sign(encodedPayload, secret)}`;
}

export function verifyPcmSessionToken(value: string | null | undefined): PcmSessionPayload | null {
  if (!value) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const [encodedPayload, signature, ...rest] = value.split(".");
  if (!encodedPayload || !signature || rest.length > 0) return null;

  const expectedSignature = sign(encodedPayload, secret);
  if (!safeEqual(signature, expectedSignature)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as
      Partial<PcmSessionPayload>;
    if (
      payload.email !== PCM_LOGIN_EMAIL ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return { email: payload.email, expiresAt: payload.expiresAt };
  } catch {
    return null;
  }
}

export async function setPcmSessionCookie(
  value: string,
  maxAge: number = PCM_SESSION_MAX_AGE_SECONDS,
  store?: CookieStore,
) {
  const cookieStore = await ensureStore(store);
  cookieStore.set(PCM_SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge,
  });
}

export async function clearPcmSessionCookie(store?: CookieStore) {
  const cookieStore = await ensureStore(store);
  cookieStore.delete(PCM_SESSION_COOKIE_NAME);
}

export async function getPcmSessionCookie(store?: CookieStore): Promise<string | null> {
  const cookieStore = await ensureStore(store);
  return cookieStore.get(PCM_SESSION_COOKIE_NAME)?.value ?? null;
}
