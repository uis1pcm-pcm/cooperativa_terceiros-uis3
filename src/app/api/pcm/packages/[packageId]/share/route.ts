import { NextResponse } from "next/server";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { createPackageShare } from "@/lib/repo/packageShares";

function normalisePackageId(params: Record<string, string | string[] | undefined>): string {
  const value = params.packageId;
  if (typeof value === "string") return decodeRouteParam(value.trim());
  if (Array.isArray(value) && value.length > 0) return decodeRouteParam(String(value[0] ?? "").trim());
  return "";
}

function normaliseServiceIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function resolveBaseUrl(req: Request): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      url.hash = "";
      url.search = "";
      return url.origin;
    } catch {
      const sanitized = configured.replace(/\/$/, "");
      if (sanitized) return sanitized;
    }
  }
  const fallback = new URL(req.url);
  fallback.hash = "";
  fallback.search = "";
  return fallback.origin;
}

export async function POST(req: Request, context: { params: Record<string, string | string[] | undefined> }) {
  await requirePcmUser(req);

  const packageId = normalisePackageId(context.params);
  if (!packageId) {
    return NextResponse.json({ ok: false, error: "packageId inválido" }, { status: 400 });
  }

  let payload: { serviceIds?: unknown } = {};
  try {
    payload = (await req.json().catch(() => ({}))) as { serviceIds?: unknown };
  } catch {
    payload = {};
  }

  const serviceIds = normaliseServiceIds(payload.serviceIds);
  if (!serviceIds.length) {
    return NextResponse.json({ ok: false, error: "Selecione pelo menos um serviço." }, { status: 400 });
  }

  try {
    const share = await createPackageShare({ packageId, serviceIds });
    const baseUrl = resolveBaseUrl(req);
    const publicUrl = `${baseUrl.replace(/\/$/, "")}/terceiro/pacote/${share.token}`;

    return NextResponse.json({
      ok: true,
      shareId: share.id,
      token: share.token,
      url: publicUrl,
    });
  } catch (error) {
    console.error("[packages/share] Falha ao gerar link público do pacote", error);
    const message =
      error instanceof Error && error.message ? error.message : "Não foi possível gerar o link público do pacote.";
    const status = message.toLowerCase().includes("selecione pelo menos um serviço") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
