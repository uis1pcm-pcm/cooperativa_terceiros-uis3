import { randomUUID } from "crypto";

import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";

import { ensureServiceAccessToken } from "@/lib/repo/accessTokens";
import {
  buildServiceImportKey,
  createService,
  findServicesByOsList,
} from "@/lib/repo/services";
import { normalizeCnpj } from "@/lib/cnpj";
import { excelDateNumberToMillis, parseXlsxTable } from "@/lib/xlsxParser";

export const runtime = "nodejs";

const HEADER_ALIASES: Record<string, string[]> = {
  os: ["O.S", "OS", "ORDEM DE SERVICO", "ORDEM DE SERVIÇO"],
  oc: ["O.C", "OC", "ORDEM DE COMPRA", "ORDEM COMPRA"],
  setor: ["SETOR", "SETOR "],
  tag: ["TAG MAQUINA", "TAG MÁQUINA", "TAG", "TAG MAQ"],
  equipamento: ["EQUIP. NOVO", "EQUIPAMENTO NOVO", "EQUIPAMENTO"],
  descricao: ["DESCRIÇÃO SERVIÇOS", "DESCRICAO SERVICOS", "DESCRIÇÃO SERVIÇO", "DESCRICAO SERVICO"],
  dataInicio: ["DATA DE INICIO", "DATA DE INÍCIO", "DATA INICIO", "INICIO"],
  dataFim: ["DATA FINAL", "DATA FIM", "FIM"],
  empresa: ["EMPRESA", "EMPRESA EXECUTANTE", "EMPRESA RESPONSAVEL", "EMPRESA RESPONSÁVEL", "CONTRATADA", "TERCEIRIZADA"],
  cnpj: ["CNPJ", "C.N.P.J.", "CNPJ "],
  horas: ["TOTAL DE HORA HOMEM", "TOTAL HORA HOMEM", "TOTAL DE HORA-HOMEM"],
};

function generateChecklistId() {
  try {
    return randomUUID();
  } catch (error) {
    return Math.random().toString(36).slice(2, 11);
  }
}

function buildDefaultChecklist() {
  return [{ id: generateChecklistId(), descricao: "GERAL", peso: 100 }];
}

function normaliseHeaderKey(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toUpperCase();
}

function pickField(row: Record<string, unknown>, aliases: string[]): unknown {
  const keys = Object.keys(row);
  const normalisedMap = new Map<string, string>(
    keys.map((key) => [normaliseHeaderKey(key), key]),
  );

  for (const alias of aliases) {
    const match = normalisedMap.get(normaliseHeaderKey(alias));
    if (match) return row[match];
  }
  return undefined;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value;
  return String(value ?? "");
}

function toRowNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
}

function normaliseOsValue(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDateValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel stores dates as serial numbers.
    return excelDateNumberToMillis(value);
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isNaN(ms) ? null : ms;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const [day, month, year] = trimmed.split(/[\/\-]/).map((part) => Number(part));
    if (Number.isFinite(day) && Number.isFinite(month) && Number.isFinite(year)) {
      const resolvedYear = year < 100 ? 2000 + year : year;
      const date = Date.UTC(resolvedYear, (month || 1) - 1, day || 1);
      const parsed = new Date(date);
      return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    }
    const parsed = Date.parse(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function parseHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    const numeric = value;
    const hasFraction = !Number.isInteger(numeric);
    const isLikelyExcelTime = numeric > 0 && numeric < 365 && (hasFraction || Number.isInteger(numeric));

    // When the column is formatted as [h]:mm:ss, Excel stores the duration as days.
    // Convert those serials back to hours so values such as 0.5 (12h) or 2 (48h)
    // are interpreted correctly.
    if (isLikelyExcelTime) {
      return numeric * 24;
    }

    return numeric;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const timeMatch = trimmed.match(/^(\d{1,3})(?::(\d{1,2}))?(?::(\d{1,2}))?$/);
    if (timeMatch) {
      const hours = Number(timeMatch[1] ?? 0);
      const minutes = Number(timeMatch[2] ?? 0);
      const seconds = Number(timeMatch[3] ?? 0);
      if ([hours, minutes, seconds].every((part) => Number.isFinite(part))) {
        return hours + minutes / 60 + seconds / 3600;
      }
    }

    const cleaned = trimmed.replace(/[^0-9,\.\-]+/g, "").replace(",", ".");
    const numeric = Number(cleaned);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

type ParsedRow = {
  os: string;
  oc: string | null;
  setor: string | null;
  tag: string;
  equipamento: string;
  descricao: string;
  inicio: number;
  fim: number;
  empresa: string | null;
  cnpj?: string | null;
  horas: number;
  sourceRowNumber: number | null;
  importKey: string;
};

async function sanitiseRow(
  row: Record<string, unknown>,
  fallback?: { empresa: string | null; cnpj: string | null },
): Promise<ParsedRow | { error: string }> {
  const os = toText(pickField(row, HEADER_ALIASES.os)).trim();
  const sourceRowNumber = toRowNumber(row.__rowNumber);
  const oc = toText(pickField(row, HEADER_ALIASES.oc)).trim() || null;
  const tag = toText(pickField(row, HEADER_ALIASES.tag)).trim();
  const equipamento = toText(pickField(row, HEADER_ALIASES.equipamento)).trim();
  const descricao = toText(pickField(row, HEADER_ALIASES.descricao)).trim();
  const setor = toText(pickField(row, HEADER_ALIASES.setor)).trim() || null;
  const empresaFromRow = toText(pickField(row, HEADER_ALIASES.empresa)).trim() || null;
  const empresa = empresaFromRow || fallback?.empresa || null;
  const cnpjRaw = toText(pickField(row, HEADER_ALIASES.cnpj)).trim();
  const cnpjParsed = cnpjRaw ? normalizeCnpj(cnpjRaw).trim() || null : null;
  const cnpj = cnpjParsed || fallback?.cnpj || null;
  const horas = parseHours(pickField(row, HEADER_ALIASES.horas));
  const inicio = parseDateValue(pickField(row, HEADER_ALIASES.dataInicio));
  const fim = parseDateValue(pickField(row, HEADER_ALIASES.dataFim));

  if (!os || !tag || !equipamento) {
    return { error: "Linha ignorada: dados essenciais ausentes (O.S., TAG ou Equipamento)." };
  }
  if (!inicio || !fim) {
    return { error: "Linha ignorada: datas de início ou fim inválidas." };
  }
  if (inicio > fim) {
    return { error: "Linha ignorada: data final anterior à data inicial." };
  }
  if (horas === null || horas <= 0) {
    return { error: "Linha ignorada: total de horas inválido." };
  }

  const importKey = await buildServiceImportKey({ os });

  if (!importKey) {
    return { error: "Linha ignorada: não foi possível gerar uma chave de importação." };
  }

  return {
    os,
    oc,
    setor,
    tag,
    equipamento,
    descricao,
    inicio,
    fim,
    empresa,
    cnpj,
    horas,
    sourceRowNumber,
    importKey,
  };
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Envie o arquivo da planilha." }, { status: 400 });
  }

  let rows: Record<string, unknown>[] = [];
  try {
    const buffer = await file.arrayBuffer();
    rows = parseXlsxTable(buffer, 8);
  } catch (error) {
    console.error("[services/import] Falha ao ler XLSX", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Não foi possível ler a planilha. Confirme se é um arquivo XLSX válido.",
      },
      { status: 400 },
    );
  }

  let skipped = 0;
  let duplicateKeys = 0;
  const seenOs = new Set<string>();
  const parsedRows: ParsedRow[] = [];
  const rowMessages: Array<{ row: number | null; error: string }> = [];

  let lastKnownCompany: string | null = null;
  let lastKnownCnpj: string | null = null;

  for (const row of rows) {
    const rowNumber = toRowNumber(row.__rowNumber);
    const parsed = await sanitiseRow(row, { empresa: lastKnownCompany, cnpj: lastKnownCnpj });
    if ("error" in parsed) {
      skipped += 1;
      rowMessages.push({ row: rowNumber, error: parsed.error });
      continue;
    }
    if (parsed.empresa) lastKnownCompany = parsed.empresa;
    if (parsed.cnpj) lastKnownCnpj = parsed.cnpj;

    const osKey = normaliseOsValue(parsed.os);
    if (seenOs.has(osKey)) {
      duplicateKeys += 1;
      rowMessages.push({ row: parsed.sourceRowNumber, error: `O.S ${parsed.os} duplicada na planilha.` });
      continue;
    }
    seenOs.add(osKey);
    parsedRows.push(parsed);
  }

  if (!parsedRows.length) {
    return NextResponse.json(
      {
        ok: false,
        error: "Nenhum serviço válido encontrado na planilha.",
      },
      { status: 400 },
    );
  }

  const existingByOs = await findServicesByOsList(parsedRows.map((item) => item.os));
  const existingOsSet = new Set(existingByOs.map((service) => normaliseOsValue(service.os)));

  const toCreate = parsedRows.filter((row) => {
    const exists = existingOsSet.has(normaliseOsValue(row.os));
    if (exists) {
      rowMessages.push({ row: row.sourceRowNumber, error: `O.S ${row.os} já existe no sistema.` });
    }
    return !exists;
  });
  const duplicatesFromDatabase = parsedRows.length - toCreate.length;

  const createdServices: Array<{ id: string; empresa: string | null }> = [];
  let createErrorCount = 0;

  for (const row of toCreate) {
    try {
      const { id } = await createService({
        os: row.os,
        oc: row.oc,
        tag: row.tag,
        equipamento: row.equipamento,
        equipmentName: row.equipamento,
        setor: row.setor,
        inicioPrevistoMillis: row.inicio,
        fimPrevistoMillis: row.fim,
        horasPrevistas: row.horas,
        empresaId: row.empresa,
        cnpj: row.cnpj ?? null,
        status: "Aberto",
        checklist: buildDefaultChecklist(),
        description: row.descricao,
        importKey: row.importKey,
      });
      createdServices.push({ id, empresa: row.empresa });
    } catch (error) {
      createErrorCount += 1;
      console.error(`[services/import] Falha ao criar serviço da linha ${row.sourceRowNumber ?? "?"}`, error);
      rowMessages.push({
        row: row.sourceRowNumber,
        error: error instanceof Error ? error.message : "Falha ao criar serviço.",
      });
    }
  }

  await Promise.all(
    createdServices.map(async (service) => {
      try {
        await ensureServiceAccessToken({ serviceId: service.id, company: service.empresa ?? undefined });
      } catch (tokenError) {
        console.error("[services/import] Falha ao gerar token para serviço importado", tokenError);
      }
    }),
  );

  if (createdServices.length > 0) {
    revalidateTag("services:available");
  }

  return NextResponse.json({
    ok: true,
    created: createdServices.length,
    duplicates: duplicateKeys + duplicatesFromDatabase,
    skipped: skipped + duplicateKeys + duplicatesFromDatabase + createErrorCount,
    errors: rowMessages,
  });
}
