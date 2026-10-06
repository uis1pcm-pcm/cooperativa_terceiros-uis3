import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";

export async function POST(request: Request) {
  try {
    await requirePcmUser(request);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Erro ao validar usuário" }, { status: 401 });
  }

  revalidateTag("services:recent");
  revalidateTag("services:summary");
  revalidateTag("services:detail");
  revalidateTag("services:available");
  revalidateTag("packages:detail");
  revalidateTag("packages:summary");
  revalidateTag("packages:services");
  revalidateTag("folders:detail");
  revalidateTag("folders:by-package");

  return NextResponse.json({ ok: true });
}
