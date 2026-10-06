import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { deleteService } from "@/lib/repo/services";

export async function DELETE(
  req: Request,
  context: { params: Promise<{ serviceId: string }> },
): Promise<NextResponse> {
  const { serviceId } = await context.params;
  const decodedId = decodeRouteParam(serviceId);
  const idCandidates = Array.from(
    new Set([decodedId, serviceId].filter((value) => typeof value === "string" && value.length > 0)),
  );

  if (idCandidates.length === 0) {
    return NextResponse.json({ ok: false, error: "serviceId ausente" }, { status: 400 });
  }

  try {
    await requirePcmUser(req);
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[api/pcm/servicos] Falha ao autenticar usuário", error);
    return NextResponse.json({ ok: false, error: "Erro ao validar usuário" }, { status: 401 });
  }

  try {
    for (const candidate of idCandidates) {
      const existed = await deleteService(candidate);
      if (existed) {
        return NextResponse.json({ ok: true });
      }
    }
    return NextResponse.json({ ok: false, error: "Serviço não encontrado" }, { status: 404 });
  } catch (error) {
    console.error(`[api/pcm/servicos] Falha ao excluir serviço ${idCandidates[0]}`, error);
    return NextResponse.json({ ok: false, error: "Erro interno ao excluir serviço" }, { status: 500 });
  }
}
