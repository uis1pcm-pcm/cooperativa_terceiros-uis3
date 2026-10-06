import "server-only";
import { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

async function ensureStore(provided?: CookieStore): Promise<CookieStore> {
  if (provided) {
    return provided;
  }
  return cookies();
}

const COOKIE_NAME = "access_token";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 7; // 7 dias

export async function setTokenCookie(token: string, store?: CookieStore) {
  const cookieStore = await ensureStore(store);
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
}

export async function getTokenCookie(store?: CookieStore): Promise<string | null> {
  const cookieStore = await ensureStore(store);
  return cookieStore.get(COOKIE_NAME)?.value ?? null;
}

export async function clearTokenCookie(store?: CookieStore) {
  const cookieStore = await ensureStore(store);
  cookieStore.delete(COOKIE_NAME);
}
