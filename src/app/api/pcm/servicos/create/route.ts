import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { createAccessToken } from "@/lib/accessTokens";
import { normalizeCnpj } from "@/lib/cnpj";
import { ensureServiceAccessToken } from "@/lib/repo/accessTokens";
import { createService } from "@/lib/repo/services";
import type { ServiceStatus } from "@/lib/types";

const STATUS_OPTIONS: ServiceStatus[] = ["Aberto", "Pendente", "Concluído"];

type ChecklistItemInput = {
  id?: unknown;
  descricao?: unknown;
  peso?: unknown;
};

type CreateServiceRequest = {
  os: string;
  oc: string | null;
  tag: string;
  equipamento: string;
  equipmentName?: string | null;
  setor: string | null;
  inicioPrevistoMillis: number;
  fimPrevistoMillis: number;
  horasPrevistas: number;
  empresaId: string | null;
  cnpj: string | null;
  status: ServiceStatus;
  checklist: Array<{ id: string; descricao: string; peso: number }>;
  description?: string | null;
};

function normaliseString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseStatus(value: unknown): ServiceStatus {
  const asString = normaliseString(value).toLowerCase();
  const match = STATUS_OPTIONS.find((option) => option.toLowerCase() === asString);
  return match ?? "Aberto";
}

function parseChecklist(value: unknown): CreateServiceRequest["checklist"] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const source = item as ChecklistItemInput;
      const id = normaliseString(source.id);
      const descricao = normaliseString(source.descricao);
      const peso = Number(source.peso);

      if (!id || !descricao || !Number.isFinite(peso)) return null;

      return {
        id,
        descricao,
        peso: Math.max(0, Math.min(100, peso)),
      };
    })
    .filter(Boolean) as CreateServiceRequest["checklist"];
}

function validateRequest(body: Record<string, unknown>): CreateServiceRequest | { error: string } {
  const os = normaliseString(body.os);
  if (!os) return { error: "Informe o número da O.S." };

  const tag = normaliseString(body.tag);
  if (!tag) return { error: "Informe a tag do equipamento." };

  const equipamento = normaliseString(body.equipamento);
  if (!equipamento) return { error: "Informe o equipamento." };

  const inicioPrevistoMillis = Number(body.inicioPrevistoMillis);
  const fimPrevistoMillis = Number(body.fimPrevistoMillis);

  if (!Number.isFinite(inicioPrevistoMillis) || !Number.isFinite(fimPrevistoMillis)) {
    return { error: "Datas inválidas. Verifique os valores informados." };
  }

  if (inicioPrevistoMillis > fimPrevistoMillis) {
    return { error: "A data de término prevista deve ser posterior ou igual à data de início." };
  }

  const horasPrevistas = Number(body.horasPrevistas);
  if (!Number.isFinite(horasPrevistas) || horasPrevistas <= 0) {
    return { error: "Horas previstas deve ser um número maior que zero." };
  }

  const checklist = parseChecklist(body.checklist);

  const resolvedCompanyId = normaliseString(body.companyId) || normaliseString(body.empresaId);

  const description = normaliseString(body.description);
  if (description.length > 1000) {
    return { error: "A descrição do serviço deve ter no máximo 1000 caracteres." };
  }
  const cnpj = normalizeCnpj(body.cnpj);

  return {
    os,
    oc: normaliseString(body.oc) || null,
    tag,
    equipamento,
    equipmentName: normaliseString(body.equipmentName) || equipamento,
    setor: normaliseString(body.setor) || null,
    inicioPrevistoMillis,
    fimPrevistoMillis,
    horasPrevistas,
    empresaId: resolvedCompanyId || null,
    cnpj: cnpj || null,
    status: normaliseStatus(body.status),
    checklist,
    description: description || null,
  };
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;

  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch (error) {
    console.error("[api/pcm/servicos/create] Payload inválido", error);
    return NextResponse.json({ ok: false, error: "Dados inválidos." }, { status: 400 });
  }

  const validated = validateRequest(body);
  if ("error" in validated) {
    return NextResponse.json({ ok: false, error: validated.error }, { status: 400 });
  }

  try {
    const { id } = await createService(validated);

    try {
      await ensureServiceAccessToken({
        serviceId: id,
        company: validated.empresaId ?? undefined,
      });
    } catch (adminTokenError) {
      console.error("[api/pcm/servicos/create] Falha ao gerar token via admin", adminTokenError);
      try {
        await createAccessToken({
          serviceId: id,
          empresa: validated.empresaId ?? undefined,
          company: validated.empresaId ?? undefined,
        });
      } catch (tokenError) {
        console.error("[api/pcm/servicos/create] Falha ao gerar token (fallback)", tokenError);
      }
    }

    revalidateTag("services:available");

    return NextResponse.json({ ok: true, serviceId: id });
  } catch (error) {
    console.error("[api/pcm/servicos/create] Falha ao criar serviço", error);
    const message =
      (error as Error | undefined)?.message === "FIREBASE_ADMIN_NOT_CONFIGURED"
        ? "Banco de dados não configurado."
        : "Não foi possível criar o serviço.";

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
