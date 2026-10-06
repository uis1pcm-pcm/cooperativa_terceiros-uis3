import "server-only";
import { cookies } from "next/headers";

type CookieStore = Awaited<ReturnType<typeof cookies>>;

async function ensureStore(provided?: CookieStore): Promise<CookieStore> {
  if (provided) {
    return provided;
  }
  return cookies();
}

export const PCM_SESSION_COOKIE_NAME = "pcm_session";
export const PCM_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours

export async function setPcmSessionCookie(
  value: string,
  maxAge: number = PCM_SESSION_MAX_AGE_SECONDS,
  store?: CookieStore,
) {
  const cookieStore = await ensureStore(store);
  cookieStore.set(PCM_SESSION_COOKIE_NAME, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: true,
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
