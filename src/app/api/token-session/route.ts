import { NextResponse } from "next/server";
import { setTokenCookie, clearTokenCookie } from "@/lib/tokenSession";

export async function POST(req: Request) {
  const { token } = await req.json().catch(() => ({}));
  if (!token || typeof token !== "string") {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }
  await setTokenCookie(token.trim().toUpperCase());
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  await clearTokenCookie();
  return NextResponse.json({ ok: true });
}
