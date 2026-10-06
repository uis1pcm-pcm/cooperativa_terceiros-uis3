import { NextResponse } from "next/server";

import { listAvailableOpenServices } from "@/lib/repo/services";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? undefined);
  const mode = (url.searchParams.get("mode") ?? undefined) as "summary" | "full" | undefined;

  try {
    const services = await listAvailableOpenServices(limit, { mode, disableCache: true });
    return NextResponse.json({ ok: true, services });
  } catch (error) {
    console.error("[services] Falha ao listar serviços disponíveis", error);
    return NextResponse.json({ ok: false, error: "Não foi possível listar os serviços disponíveis." }, { status: 500 });
  }
}
