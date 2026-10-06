import { NextResponse } from "next/server";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { deletePackageFolder, updatePackageFolder } from "@/lib/repo/folders";

function normaliseParam(value: string | string[] | undefined): string {
  if (typeof value === "string") return decodeRouteParam(value.trim());
  if (Array.isArray(value) && value.length > 0) return decodeRouteParam(String(value[0] ?? "").trim());
  return "";
}

export async function PATCH(
  req: Request,
  context: { params: Record<string, string | string[] | undefined> },
) {
  await requirePcmUser(req);
  const packageId = normaliseParam(context.params.packageId);
  const folderId = normaliseParam(context.params.folderId);

  if (!packageId || !folderId) {
    return NextResponse.json({ ok: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  let payload: { name?: unknown; companyId?: unknown } = {};
  try {
    payload = (await req.json().catch(() => ({}))) as { name?: unknown; companyId?: unknown };
  } catch {
    payload = {};
  }

  const updates: { name?: string; companyId?: string | null } = {};
  if (payload.name !== undefined) {
    const value = typeof payload.name === "string" ? payload.name : String(payload.name ?? "");
    updates.name = value.trim();
  }
  if (payload.companyId !== undefined) {
    const value = typeof payload.companyId === "string" ? payload.companyId : String(payload.companyId ?? "");
    const trimmed = value.trim();
    updates.companyId = trimmed || null;
  }

  if (!("name" in updates) && !("companyId" in updates)) {
    return NextResponse.json({ ok: false, error: "Nenhum campo para atualizar" }, { status: 400 });
  }

  try {
    const folder = await updatePackageFolder(folderId, updates);
    return NextResponse.json({ ok: true, folder });
  } catch (error) {
    console.error("[folders] Falha ao atualizar subpacote", error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o subpacote.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function DELETE(
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
    const result = await deletePackageFolder(folderId);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[folders] Falha ao excluir subpacote", error);
    const message = error instanceof Error ? error.message : "Não foi possível excluir o subpacote.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
