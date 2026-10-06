import { NextResponse } from "next/server";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { createPackageFolder, listPackageFolders } from "@/lib/repo/folders";

function normalisePackageId(params: Record<string, string | string[] | undefined>): string {
  const value = params.packageId;
  if (typeof value === "string") return decodeRouteParam(value.trim());
  if (Array.isArray(value) && value.length > 0) return decodeRouteParam(String(value[0] ?? "").trim());
  return "";
}

export async function GET(req: Request, context: { params: Record<string, string | string[] | undefined> }) {
  await requirePcmUser(req);
  const packageId = normalisePackageId(context.params);
  if (!packageId) {
    return NextResponse.json({ ok: false, error: "packageId inválido" }, { status: 400 });
  }

  try {
    const folders = await listPackageFolders(packageId);
    return NextResponse.json({ ok: true, folders });
  } catch (error) {
    console.error("[folders] Falha ao listar subpacotes", error);
    return NextResponse.json({ ok: false, error: "Não foi possível carregar os subpacotes." }, { status: 500 });
  }
}

export async function POST(req: Request, context: { params: Record<string, string | string[] | undefined> }) {
  await requirePcmUser(req);
  const packageId = normalisePackageId(context.params);
  if (!packageId) {
    return NextResponse.json({ ok: false, error: "packageId inválido" }, { status: 400 });
  }

  let payload: { name?: unknown; companyId?: unknown } = {};
  try {
    payload = (await req.json().catch(() => ({}))) as { name?: unknown; companyId?: unknown };
  } catch {
    payload = {};
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const companyId = typeof payload.companyId === "string" ? payload.companyId.trim() : undefined;

  if (!name) {
    return NextResponse.json({ ok: false, error: "Informe o nome do subpacote." }, { status: 400 });
  }

  try {
    const folder = await createPackageFolder({ packageId, name, companyId });
    return NextResponse.json({ ok: true, folder });
  } catch (error) {
    console.error("[folders] Falha ao criar subpacote", error);
    const message = error instanceof Error ? error.message : "Não foi possível criar o subpacote.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
