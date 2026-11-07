import { NextResponse } from "next/server";

import {
  clearPcmSessionCookie,
  createPcmSessionToken,
  getPcmSessionCookie,
  PCM_SESSION_MAX_AGE_SECONDS,
  setPcmSessionCookie,
  verifyPcmCredentials,
  verifyPcmSessionToken,
} from "@/lib/auth/pcmSession";

export async function GET() {
  const session = verifyPcmSessionToken(await getPcmSessionCookie());
  return NextResponse.json({
    authenticated: Boolean(session),
    email: session?.email ?? null,
  });
}

export async function POST(req: Request) {
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Credenciais inválidas." }, { status: 401 });
  }

  const credentials = body as { email?: unknown; password?: unknown };
  if (!verifyPcmCredentials(credentials.email, credentials.password)) {
    return NextResponse.json({ error: "E-mail ou senha inválidos." }, { status: 401 });
  }

  try {
    await setPcmSessionCookie(createPcmSessionToken(), PCM_SESSION_MAX_AGE_SECONDS);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[pcm-session] Não foi possível criar a sessão PCM", error);
    return NextResponse.json(
      { error: "Configuração de sessão indisponível. Contate o suporte." },
      { status: 503 },
    );
  }
}

export async function DELETE() {
  await clearPcmSessionCookie();
  return NextResponse.json({ ok: true });
}
