import { NextResponse } from "next/server";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { setFolderServices } from "@/lib/repo/folders";

function normaliseParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return decodeRouteParam(value.trim());
  if (Array.isArray(value) && value.length > 0) return decodeRouteParam(String(value[0] ?? "").trim());
  return "";
}

export async function PUT(
  req: Request,
  context: { params: Record<string, string | string[] | undefined> },
) {
  await requirePcmUser(req);
  const packageId = normaliseParam(context.params.packageId);
  const folderId = normaliseParam(context.params.folderId);

  if (!packageId || !folderId) {
    return NextResponse.json({ ok: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  let payload: { services?: unknown } = {};
  try {
    payload = (await req.json().catch(() => ({}))) as { services?: unknown };
  } catch {
    payload = {};
  }

  if (!Array.isArray(payload.services)) {
    return NextResponse.json({ ok: false, error: "Lista de serviços inválida" }, { status: 400 });
  }

  const services = payload.services
    .map((value) => (typeof value === "string" ? value.trim() : String(value ?? "")))
    .filter((value) => value.length > 0);

  try {
    const folder = await setFolderServices(folderId, services);
    return NextResponse.json({ ok: true, folder });
  } catch (error) {
    console.error("[folders] Falha ao atualizar serviços do subpacote", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar os serviços.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
