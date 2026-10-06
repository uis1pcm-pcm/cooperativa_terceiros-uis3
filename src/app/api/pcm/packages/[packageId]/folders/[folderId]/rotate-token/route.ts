import { NextResponse } from "next/server";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { rotateFolderToken } from "@/lib/repo/folders";

function normaliseParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return decodeRouteParam(value.trim());
  if (Array.isArray(value) && value.length > 0) return decodeRouteParam(String(value[0] ?? "").trim());
  return "";
}

export async function POST(
  req: Request,
  context: { params: Record<string, string | string[] | undefined> },
) {
  await requirePcmUser(req);
  const packageId = normaliseParam(context.params.packageId);
  const folderId = normaliseParam(context.params.folderId);

  if (!packageId || !folderId) {
    return NextResponse.json({ ok: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  try {
    const folder = await rotateFolderToken(folderId);
    return NextResponse.json({ ok: true, folder });
  } catch (error) {
    console.error("[folders] Falha ao rotacionar token do subpacote", error);
    const message = error instanceof Error ? error.message : "Não foi possível gerar um novo token.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
