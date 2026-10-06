import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { removeEvidenceFromUpdate } from "@/lib/repo/services";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ serviceId: string; updateId: string }> },
): Promise<NextResponse> {
  const { serviceId, updateId } = await context.params;
  const decodedServiceId = decodeRouteParam(serviceId);
  const decodedUpdateId = decodeRouteParam(updateId);

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Body inválido" }, { status: 400 });
  }

  const evidenceUrl =
    body && typeof body === "object" && typeof (body as { evidenceUrl?: unknown }).evidenceUrl === "string"
      ? String((body as { evidenceUrl: string }).evidenceUrl)
      : "";

  if (!decodedServiceId || !decodedUpdateId || !evidenceUrl.trim()) {
    return NextResponse.json({ ok: false, error: "Parâmetros inválidos" }, { status: 400 });
  }

  try {
    await requirePcmUser(req);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    return NextResponse.json({ ok: false, error: "Erro ao validar usuário" }, { status: 401 });
  }

  try {
    const updated = await removeEvidenceFromUpdate(decodedServiceId, decodedUpdateId, evidenceUrl);
    if (!updated) {
      return NextResponse.json({ ok: false, error: "Atualização não encontrada" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/pcm/servicos/:serviceId/updates/:updateId/evidence] Falha ao remover evidência", error);
    return NextResponse.json({ ok: false, error: "Erro ao remover evidência" }, { status: 500 });
  }
}
