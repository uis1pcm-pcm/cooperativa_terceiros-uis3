import { NextResponse, type NextRequest } from "next/server";

import { recomputeServiceProgress } from "@/lib/progressHistoryServer";
import { AdminDbUnavailableError } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";

type RequestBody = { serviceId?: unknown };

function normaliseServiceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function POST(request: NextRequest) {
  let body: RequestBody;

  try {
    body = (await request.json()) as RequestBody;
  } catch (error) {
    console.error("[pcm/servicos/recompute-progress] Falha ao ler payload", error);
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const serviceId = normaliseServiceId(body.serviceId);
  if (!serviceId) {
    return NextResponse.json({ ok: false, error: "missing_service_id" }, { status: 400 });
  }

  try {
    const { percent, lastUpdate } = await recomputeServiceProgress(serviceId);
    return NextResponse.json({ ok: true, percent, lastUpdate });
  } catch (error) {
    if (error instanceof AdminDbUnavailableError) {
      console.error("[pcm/servicos/recompute-progress] Firebase Admin indisponível", error);
      return NextResponse.json({ ok: false, error: "admin_unavailable" }, { status: 500 });
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn("[pcm/servicos/recompute-progress] Falha ao recalcular progresso", error);
      return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
    }

    console.error("[pcm/servicos/recompute-progress] Erro inesperado", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}

