import { NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";

import { requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { normalizeCnpj } from "@/lib/cnpj";
import { excelDateNumberToMillis, parseXlsxTable } from "@/lib/xlsxParser";
import { getAdmin } from "@/lib/firebaseAdmin";
import { buildServiceImportKey, createService, findServicesByImportKeys } from "@/lib/repo/services";
import { ensureServiceAccessToken } from "@/lib/repo/accessTokens";
import { createPackageFolder, listPackageFolders, setFolderServices } from "@/lib/repo/folders";

export const runtime = "nodejs";

type ParsedRow = {
  rowNumber: number;
  os: string;
  oc: string | null;
  cnpj: string | null;
  tag: string;
  equipamento: string;
  setor: string | null;
  empresa: string;
  descricao: string;
  dataInicioPrevista: number;
  dataFimPrevista: number;
  horasPrevistas: number;
  importKey: string;
  legacyImportKey: string;
};

const HEADER_ALIASES: Record<string, string[]> = {
  os: ["O.S", "OS"],
  oc: ["O.C", "OC"],
  cnpj: ["CNPJ", "C.N.P.J."],
  tag: ["TAG MAQUINA", "TAG", "TAG MÁQUINA"],
  equipamento: ["EQUIP. NOVO", "EQUIPAMENTO NOVO", "EQUIPAMENTO"],
  setor: ["SETOR"],
  empresa: ["EMPRESA"],
  dataInicio: ["DATA DE INICIO", "DATA DE INÍCIO", "INICIO"],
  dataFim: ["DATA FINAL", "DATA FIM", "FIM"],
  horas: ["TOTAL DE HORA HOMEM", "TOTAL HORA HOMEM", "TOTAL DE HORA-HOMEM"],
  descricao: ["DESCRIÇÃO SERVIÇOS", "DESCRICAO SERVICOS", "DESCRIÇÃO SERVIÇO", "DESCRICAO SERVICO"],
};

function normaliseHeaderKey(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, " ").trim().toUpperCase();
}

function pickField(row: Record<string, unknown>, aliases: string[]): unknown {
  const normalisedMap = new Map<string, string>(Object.keys(row).map((key) => [normaliseHeaderKey(key), key]));
  for (const alias of aliases) {
    const match = normalisedMap.get(normaliseHeaderKey(alias));
    if (match) return row[match];
  }
  return undefined;
}

const toText = (value: unknown) => (value === null || value === undefined ? "" : String(value));

function toRowNumber(value: unknown): number | null {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : null;
}

function normaliseCompanyName(value: string): { raw: string; key: string } {
  const raw = value.trim().replace(/\s+/g, " ");
  return { raw, key: raw.toLocaleLowerCase("pt-BR") };
}

function parseDateValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return excelDateNumberToMillis(value);

  const text = toText(value).trim();
  if (!text) return null;
  const dmy = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    return Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1]));
  }
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (ymd) return Date.UTC(Number(ymd[1]), Number(ymd[2]) - 1, Number(ymd[3]));

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseHours(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 0 && value < 1000 && !Number.isInteger(value)) return value * 24;
    return value;
  }
  const text = toText(value).trim();
  if (!text) return null;
  const timeMatch = text.match(/^(\d{1,3})(?::(\d{1,2}))(?::(\d{1,2}))?$/);
  if (timeMatch) return Number(timeMatch[1]) + Number(timeMatch[2] ?? 0) / 60 + Number(timeMatch[3] ?? 0) / 3600;

  const decimal = Number(text.replace(",", "."));
  return Number.isFinite(decimal) ? decimal : null;
}

export async function POST(req: Request, ctx: { params: { packageId: string } }) {
  try {
    await requirePcmUser(req);

    const packageId = decodeRouteParam(ctx.params.packageId || "").trim();
    if (!packageId) return NextResponse.json({ ok: false, error: "packageId inválido" }, { status: 400 });

    const formData = await req.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Envie o arquivo." }, { status: 400 });

    const rows = parseXlsxTable(await file.arrayBuffer(), 8); // header line 8, data from line 9
    const parsedRows: ParsedRow[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const rowNumber = toRowNumber(row.__rowNumber) ?? index + 9;
      const os = toText(pickField(row, HEADER_ALIASES.os)).trim();
      const oc = toText(pickField(row, HEADER_ALIASES.oc)).trim() || null;
      const cnpj = normalizeCnpj(toText(pickField(row, HEADER_ALIASES.cnpj)).trim()) || null;
      const tag = toText(pickField(row, HEADER_ALIASES.tag)).trim();
      const equipamento = toText(pickField(row, HEADER_ALIASES.equipamento)).trim();
      const setor = toText(pickField(row, HEADER_ALIASES.setor)).trim() || null;
      const empresaOriginal = toText(pickField(row, HEADER_ALIASES.empresa)).trim();
      const descricao = toText(pickField(row, HEADER_ALIASES.descricao)).trim();
      const dataInicioPrevista = parseDateValue(pickField(row, HEADER_ALIASES.dataInicio));
      const dataFimPrevista = parseDateValue(pickField(row, HEADER_ALIASES.dataFim));
      const horasPrevistas = parseHours(pickField(row, HEADER_ALIASES.horas));

      if (!os && !oc && !tag && !equipamento && !setor && !empresaOriginal && !descricao) continue;
      if (!empresaOriginal || !descricao) { errors.push({ row: rowNumber, error: "EMPRESA e DESCRIÇÃO SERVIÇOS são obrigatórios." }); continue; }
      if (!os || !tag || !equipamento) { errors.push({ row: rowNumber, error: "O.S, TAG MAQUINA e EQUIP. NOVO são obrigatórios." }); continue; }
      if (!dataInicioPrevista || !dataFimPrevista) { errors.push({ row: rowNumber, error: "DATA DE INICIO e DATA FINAL inválidas." }); continue; }
      if (dataFimPrevista < dataInicioPrevista) { errors.push({ row: rowNumber, error: "DATA FINAL menor que DATA DE INICIO." }); continue; }
      if (horasPrevistas === null || horasPrevistas <= 0) { errors.push({ row: rowNumber, error: "TOTAL DE HORA HOMEM inválido." }); continue; }

      const { raw: empresa } = normaliseCompanyName(empresaOriginal);
      parsedRows.push({
        rowNumber, os, oc, cnpj, tag, equipamento, setor, empresa, descricao,
        dataInicioPrevista, dataFimPrevista, horasPrevistas,
        importKey: await buildServiceImportKey({ os, oc, tag, setor, equipmentName: equipamento, plannedStart: dataInicioPrevista, plannedEnd: dataFimPrevista, empresa, cnpj, description: descricao, totalHours: horasPrevistas, sourceRow: rowNumber }),
        legacyImportKey: await buildServiceImportKey({ os, tag, setor, equipmentName: equipamento, plannedStart: dataInicioPrevista, plannedEnd: dataFimPrevista, empresa, cnpj, description: descricao, totalHours: horasPrevistas }),
      });
    }

    if (!parsedRows.length) return NextResponse.json({ ok: false, error: "Nenhuma linha válida para importar.", errors }, { status: 400 });
    const importKeysToCheck = Array.from(new Set(parsedRows.flatMap((row) => [row.importKey, row.legacyImportKey]).filter(Boolean)));
    const existingServices = await findServicesByImportKeys(importKeysToCheck);
    const existingImportKeys = new Set(
      existingServices.map((service) => (typeof service.importKey === "string" ? service.importKey.trim() : "")).filter(Boolean),
    );

    const folderByCompanyKey = new Map((await listPackageFolders(packageId)).map((folder) => [normaliseCompanyName(folder.name).key, folder] as const));
    const folderServicesSnapshot = new Map<string, string[]>(
      Array.from(folderByCompanyKey.values()).map((folder) => [
        folder.id,
        [...(folder.services ?? [])],
      ]),
    );
    let foldersCreated = 0;
    for (const row of parsedRows) {
      const normalized = normaliseCompanyName(row.empresa);
      if (folderByCompanyKey.has(normalized.key)) continue;
      const createdFolder = await createPackageFolder({ packageId, name: normalized.raw, companyId: row.cnpj });
      folderByCompanyKey.set(normalized.key, createdFolder);
      folderServicesSnapshot.set(createdFolder.id, [...(createdFolder.services ?? [])]);
      foldersCreated += 1;
    }

    const db = getAdmin().db;
    let created = 0;
    const createdServiceIdsByFolder = new Map<string, string[]>();
    for (const row of parsedRows) {
      if (existingImportKeys.has(row.importKey) || existingImportKeys.has(row.legacyImportKey)) {
        errors.push({
          row: row.rowNumber,
          error: "Serviço já existe no sistema e não pode ser vinculado a outro pacote.",
        });
        continue;
      }
      const folder = folderByCompanyKey.get(normaliseCompanyName(row.empresa).key);
      try {
        const created = await createService({
          os: row.os,
          oc: row.oc,
          tag: row.tag,
          equipamento: row.equipamento,
          equipmentName: row.equipamento,
          setor: row.setor,
          inicioPrevistoMillis: row.dataInicioPrevista,
          fimPrevistoMillis: row.dataFimPrevista,
          horasPrevistas: row.horasPrevistas,
          empresaId: row.empresa,
          cnpj: row.cnpj,
          status: "Aberto",
          checklist: [{ id: "GERAL", descricao: "GERAL", peso: 100 }],
          description: row.descricao,
          importKey: row.importKey,
        });
        const createdRef = db.collection("services").doc(created.id);
        await createdRef.set({
          empresa: row.empresa,
          company: row.empresa,
          companyId: row.empresa,
          empresaId: row.empresa,
          descricao: row.descricao,
          packageId,
          pacoteId: packageId,
          folderId: folder?.id ?? null,
          subpackageId: folder?.id ?? null,
          inicioPrevisto: Timestamp.fromMillis(row.dataInicioPrevista),
          fimPrevisto: Timestamp.fromMillis(row.dataFimPrevista),
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        if (folder?.id) {
          const list = createdServiceIdsByFolder.get(folder.id) ?? [];
          list.push(created.id);
          createdServiceIdsByFolder.set(folder.id, list);
        }
        try {
          await ensureServiceAccessToken({
            serviceId: created.id,
            company: row.empresa || undefined,
          });
        } catch (tokenError) {
          errors.push({
            row: row.rowNumber,
            error:
              tokenError instanceof Error
                ? `Serviço criado, mas falhou ao gerar token: ${tokenError.message}`
                : "Serviço criado, mas falhou ao gerar token.",
          });
        }
        created += 1;
      } catch (error) {
        errors.push({ row: row.rowNumber, error: error instanceof Error ? error.message : "Falha ao criar serviço." });
      }
    }

    for (const [folderId, createdIds] of createdServiceIdsByFolder.entries()) {
      const merged = Array.from(new Set([...(folderServicesSnapshot.get(folderId) ?? []), ...createdIds]));
      try {
        const updatedFolder = await setFolderServices(folderId, merged);
        folderServicesSnapshot.set(folderId, [...updatedFolder.services]);
        const key = normaliseCompanyName(updatedFolder.name).key;
        folderByCompanyKey.set(key, updatedFolder);
      } catch (error) {
        errors.push({
          row: 0,
          error: `Falha ao vincular serviços ao subpacote ${folderId}: ${error instanceof Error ? error.message : "erro desconhecido"}`,
        });
      }
    }

    return NextResponse.json({ ok: true, created, skipped: errors.length, foldersCreated, errors });
  } catch (error) {
    console.error("[api/pcm/packages/import] Falha inesperada ao importar planilha", error);
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Não foi possível importar a planilha para o pacote." }, { status: 500 });
  }
}
