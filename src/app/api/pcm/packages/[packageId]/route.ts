import { NextResponse } from "next/server";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { deletePackage, updatePackageMetadata } from "@/lib/repo/packages";

function normalisePackageId(params: Record<string, string | string[] | undefined>): string {
  const value = params.packageId;
  if (typeof value === "string") return decodeRouteParam(value.trim());
  if (Array.isArray(value) && value.length > 0) return decodeRouteParam(String(value[0] ?? "").trim());
  return "";
}

function pickString(
  payload: Record<string, unknown>,
  keys: string[],
): string | null | undefined {
  for (const key of keys) {
    if (key in payload) {
      const value = payload[key];
      if (typeof value === "string") {
        return value;
      }
      if (value === null) {
        return null;
      }
      return undefined;
    }
  }
  return undefined;
}

export async function PATCH(
  req: Request,
  context: { params: Record<string, string | string[] | undefined> },
) {
  await requirePcmUser(req);
  const packageId = normalisePackageId(context.params);
  if (!packageId) {
    return NextResponse.json({ ok: false, error: "packageId inválido" }, { status: 400 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const updates: Parameters<typeof updatePackageMetadata>[1] = {};
  let provided = false;

  if (Object.prototype.hasOwnProperty.call(payload, "name")) {
    provided = true;
    const value = payload.name;
    if (typeof value !== "string") {
      return NextResponse.json({ ok: false, error: "Nome inválido." }, { status: 400 });
    }
    updates.name = value;
  }

  const description = pickString(payload, ["description", "descricao", "details"]);
  if (description !== undefined) {
    provided = true;
    if (description === null) {
      updates.description = null;
    } else if (typeof description === "string") {
      updates.description = description;
    } else {
      return NextResponse.json({ ok: false, error: "Descrição inválida." }, { status: 400 });
    }
  }

  const plannedStart = pickString(payload, ["plannedStart", "dataInicio", "inicioPlanejado", "startDate"]);
  if (plannedStart !== undefined) {
    provided = true;
    if (plannedStart === null) {
      return NextResponse.json({ ok: false, error: "Data inicial inválida." }, { status: 400 });
    }
    updates.plannedStart = plannedStart;
  }

  const plannedEnd = pickString(payload, ["plannedEnd", "dataFim", "fimPlanejado", "endDate"]);
  if (plannedEnd !== undefined) {
    provided = true;
    if (plannedEnd === null) {
      return NextResponse.json({ ok: false, error: "Data final inválida." }, { status: 400 });
    }
    updates.plannedEnd = plannedEnd;
  }

  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    provided = true;
    const value = payload.status;
    if (typeof value !== "string") {
      return NextResponse.json({ ok: false, error: "Status inválido." }, { status: 400 });
    }
    updates.status = value;
  }

  const code = pickString(payload, ["code", "codigo"]);
  if (code !== undefined) {
    provided = true;
    if (code === null) {
      updates.code = null;
    } else if (typeof code === "string") {
      updates.code = code;
    } else {
      return NextResponse.json({ ok: false, error: "Código inválido." }, { status: 400 });
    }
  }

  if (!provided) {
    return NextResponse.json(
      { ok: false, error: "Nenhuma alteração foi enviada." },
      { status: 400 },
    );
  }

  try {
    const updated = await updatePackageMetadata(packageId, updates);
    return NextResponse.json({ ok: true, package: updated });
  } catch (error) {
    console.error(`[packages/${packageId}] Falha ao atualizar pacote`, error);
    const message = error instanceof Error ? error.message : "Não foi possível atualizar o pacote.";
    let status = 500;
    if (error instanceof Error) {
      if (/não encontrado/i.test(message)) {
        status = 404;
      } else if (/inválid|informe|posterior/i.test(message)) {
        status = 400;
      }
    }
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function DELETE(
  req: Request,
  context: { params: Record<string, string | string[] | undefined> },
) {
  await requirePcmUser(req);
  const packageId = normalisePackageId(context.params);
  if (!packageId) {
    return NextResponse.json({ ok: false, error: "packageId inválido" }, { status: 400 });
  }

  try {
    const existed = await deletePackage(packageId);
    if (!existed) {
      return NextResponse.json({ ok: false, error: "Pacote não encontrado." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[packages/${packageId}] Falha ao excluir pacote`, error);
    const message = error instanceof Error ? error.message : "Não foi possível excluir o pacote.";
    const status = error instanceof Error && /inválido/i.test(message) ? 400 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
