import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { updateServiceMetadata } from "@/lib/repo/services";
import type { ServiceStatus } from "@/lib/types";

function normaliseServiceId(params: Record<string, string | string[] | undefined>): string {
  const value = params.serviceId;
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value) && value.length > 0) return String(value[0] ?? "").trim();
  return "";
}

function parseStatus(value: unknown): ServiceStatus | null {
  if (typeof value !== "string") return null;
  const normalised = value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (normalised === "aberto") return "Aberto";
  if (normalised === "pendente") return "Pendente";
  if (normalised === "concluido" || normalised === "encerrado") return "Concluído";
  return null;
}

function normaliseDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const date = new Date(`${trimmed}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return trimmed;
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
    console.error("[management/services/update] Falha ao autenticar usuário", error);
    return NextResponse.json({ ok: false, error: "Não foi possível validar o usuário." }, { status: 401 });
  }

  const serviceId = normaliseServiceId(context.params);
  if (!serviceId) {
    return NextResponse.json({ ok: false, error: "serviceId inválido" }, { status: 400 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  } catch {
    payload = {};
  }

  const os = typeof payload.os === "string" ? payload.os.trim() : "";
  const tag = typeof payload.tag === "string" ? payload.tag.trim() : "";
  const equipment = typeof payload.equipmentName === "string" ? payload.equipmentName.trim() : "";
  const oc = typeof payload.oc === "string" ? payload.oc.trim() : "";
  const sector = typeof payload.sector === "string" ? payload.sector.trim() : "";
  const company = typeof payload.company === "string" ? payload.company.trim() : "";
  const cnpj = typeof payload.cnpj === "string" ? payload.cnpj.trim() : "";
  const plannedStart = normaliseDate(payload.plannedStart);
  const plannedEnd = normaliseDate(payload.plannedEnd);
  const totalHours = Number(payload.totalHours);
  const status = parseStatus(payload.status);

  if (!os || !tag || !equipment) {
    return NextResponse.json({ ok: false, error: "Campos obrigatórios ausentes." }, { status: 400 });
  }

  if (!plannedStart || !plannedEnd) {
    return NextResponse.json({ ok: false, error: "Datas inválidas." }, { status: 400 });
  }

  if (!Number.isFinite(totalHours) || totalHours <= 0) {
    return NextResponse.json({ ok: false, error: "Horas totais inválidas." }, { status: 400 });
  }

  if (!status) {
    return NextResponse.json({ ok: false, error: "Status inválido." }, { status: 400 });
  }

  try {
    await updateServiceMetadata(serviceId, {
      os,
      tag,
      equipment,
      oc: oc || null,
      sector: sector || null,
      company: company || null,
      cnpj: cnpj || null,
      plannedStart,
      plannedEnd,
      totalHours,
      status,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[management/services/update] Falha ao salvar serviço", error);
    const message = error instanceof Error ? error.message : "Não foi possível salvar as alterações.";
    const statusCode = message.includes("encontrado") ? 404 : 500;
    return NextResponse.json({ ok: false, error: message }, { status: statusCode });
  }
}
