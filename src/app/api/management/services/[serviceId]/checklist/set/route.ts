import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { setChecklistItems } from "@/lib/repo/services";

function normaliseServiceId(params: Record<string, string | string[] | undefined>): string {
  const value = params.serviceId;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && value.length > 0) return String(value[0] ?? "").trim();
  return "";
}

export async function POST(
  req: Request,
  context: { params: Record<string, string | string[] | undefined> },
) {
  try {
    await requirePcmUser(req);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[management/services/checklist] Falha ao autenticar usuário", error);
    return NextResponse.json({ ok: false, error: "Não foi possível validar o usuário." }, { status: 401 });
  }

  const serviceId = normaliseServiceId(context.params);
  if (!serviceId) {
    return NextResponse.json({ ok: false, error: "serviceId inválido" }, { status: 400 });
  }

  let payload: { items?: unknown } = {};
  try {
    payload = (await req.json().catch(() => ({}))) as { items?: unknown };
  } catch {
    payload = {};
  }

  if (!Array.isArray(payload.items)) {
    return NextResponse.json({ ok: false, error: "Itens do checklist inválidos." }, { status: 400 });
  }

  const items = payload.items
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as { description?: unknown; weight?: unknown };
      const description = typeof record.description === "string" ? record.description.trim() : "";
      const weight = Number(record.weight);
      if (!description || !Number.isFinite(weight)) return null;
      const clamped = Math.max(0, Math.min(100, Math.round(weight)));
      return { description, weight: clamped };
    })
    .filter((item): item is { description: string; weight: number } => Boolean(item));

  try {
    await setChecklistItems(serviceId, items);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[management/services/checklist] Falha ao salvar checklist", error);
    const message = error instanceof Error ? error.message : "Não foi possível salvar o checklist.";
    const status = message.includes("100") ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
