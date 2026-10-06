import { inflateRawSync } from "node:zlib";

const TEXT_DECODER = new TextDecoder("utf-8");

const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;

function readUint16LE(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

function readUint32LE(data: Uint8Array, offset: number): number {
  return (
    data[offset] |
    (data[offset + 1] << 8) |
    (data[offset + 2] << 16) |
    (data[offset + 3] << 24)
  );
}

function decodeText(buffer: Uint8Array): string {
  return TEXT_DECODER.decode(buffer);
}

function findEndOfCentralDirectory(data: Uint8Array): number {
  // EOCD record is at least 22 bytes. Search within the last 64KB per spec.
  const minOffset = Math.max(0, data.length - 0x10000);
  for (let i = data.length - 22; i >= minOffset; i -= 1) {
    if (
      data[i] === 0x50 &&
      data[i + 1] === 0x4b &&
      data[i + 2] === 0x05 &&
      data[i + 3] === 0x06
    ) {
      return i;
    }
  }
  return -1;
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function columnLettersToIndex(column: string): number {
  let result = 0;
  for (let i = 0; i < column.length; i += 1) {
    result = result * 26 + (column.charCodeAt(i) - 64);
  }
  return result - 1; // zero-based
}

type ZipEntry = {
  fileName: string;
  offset: number;
  compressedSize: number;
  compressionMethod: number;
};

function parseCentralDirectory(data: Uint8Array): Record<string, ZipEntry> {
  const eocdOffset = findEndOfCentralDirectory(data);
  if (eocdOffset < 0) {
    throw new Error("Arquivo XLSX inválido (EOCD não encontrado).");
  }

  const centralDirectoryOffset = readUint32LE(data, eocdOffset + 16);
  const entries: Record<string, ZipEntry> = {};
  let offset = centralDirectoryOffset;

  while (offset + 46 < data.length) {
    const signature = readUint32LE(data, offset);
    if (signature !== CENTRAL_DIRECTORY_SIGNATURE) break;

    const compressionMethod = readUint16LE(data, offset + 10);
    const compressedSize = readUint32LE(data, offset + 20);
    const fileNameLength = readUint16LE(data, offset + 28);
    const extraLength = readUint16LE(data, offset + 30);
    const commentLength = readUint16LE(data, offset + 32);
    const localHeaderOffset = readUint32LE(data, offset + 42);

    const nameStart = offset + 46;
    const nameEnd = nameStart + fileNameLength;
    const fileName = decodeText(data.slice(nameStart, nameEnd));

    entries[fileName] = {
      fileName,
      offset: localHeaderOffset,
      compressedSize,
      compressionMethod,
    };

    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function extractEntryData(data: Uint8Array, entry: ZipEntry): Uint8Array {
  const headerOffset = entry.offset;
  const signature = readUint32LE(data, headerOffset);
  if (signature !== LOCAL_FILE_HEADER_SIGNATURE) {
    throw new Error("Arquivo XLSX inválido (local header).");
  }

  const compressionMethod = readUint16LE(data, headerOffset + 8);
  const compressedSize = readUint32LE(data, headerOffset + 18) || entry.compressedSize;
  const fileNameLength = readUint16LE(data, headerOffset + 26);
  const extraLength = readUint16LE(data, headerOffset + 28);

  const dataStart = headerOffset + 30 + fileNameLength + extraLength;
  const compressedData = data.slice(dataStart, dataStart + compressedSize);

  if (compressionMethod === 0) {
    return compressedData;
  }
  if (compressionMethod === 8) {
    return inflateRawSync(compressedData);
  }

  throw new Error("Método de compressão não suportado no XLSX.");
}

function parseSharedStringsXml(xml: string): string[] {
  const results: string[] = [];
  const siRegex = /<si>([\s\S]*?)<\/si>/g;
  let match: RegExpExecArray | null;
  while ((match = siRegex.exec(xml))) {
    const entry = match[1];
    const textParts = Array.from(entry.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)).map((part) =>
      decodeXmlEntities(part[1]),
    );
    results.push(textParts.join(""));
  }
  return results;
}

type WorksheetRow = {
  index: number;
  cells: Record<number, string | number | null>;
};

function parseWorksheetXml(xml: string, sharedStrings: string[]): WorksheetRow[] {
  const rows: WorksheetRow[] = [];
  const rowRegex = /<row[^>]*r=\"?(\d+)\"?[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRegex.exec(xml))) {
    const rowIndex = Number(rowMatch[1]);
    const cells: Record<number, string | number | null> = {};
    const cellContent = rowMatch[2];
    const cellRegex = /<c([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRegex.exec(cellContent))) {
      const attributes = cellMatch[1];
      const cellValueContent = cellMatch[2];
      const refMatch = attributes.match(/r=\"([A-Z]+)(\d+)\"/);
      if (!refMatch) continue;
      const columnIndex = columnLettersToIndex(refMatch[1]);
      const typeMatch = attributes.match(/t=\"(\w+)\"/);
      const type = typeMatch?.[1];
      const valueMatch = cellValueContent.match(/<v>([\s\S]*?)<\/v>/);
      const inlineTextMatch = cellValueContent.match(/<t[^>]*>([\s\S]*?)<\/t>/);
      let value: string | number | null = null;

      if (type === "s" && valueMatch) {
        const idx = Number(valueMatch[1]);
        value = Number.isFinite(idx) && idx < sharedStrings.length ? sharedStrings[idx] : "";
      } else if (type === "inlineStr" && inlineTextMatch) {
        value = decodeXmlEntities(inlineTextMatch[1]);
      } else if (valueMatch) {
        const raw = valueMatch[1];
        const numeric = Number(raw);
        value = Number.isFinite(numeric) ? numeric : decodeXmlEntities(raw.trim());
      }

      cells[columnIndex] = value;
    }
    rows.push({ index: rowIndex, cells });
  }
  return rows.sort((a, b) => a.index - b.index);
}

function rowsToObjects(rows: WorksheetRow[], headerRowIndex = 8): Record<string, unknown>[] {
  const headerRow = rows.find((row) => row.index === headerRowIndex);
  if (!headerRow) return [];

  const headers = headerRow.cells;
  const objects: Record<string, unknown>[] = [];

  rows
    .filter((row) => row.index > headerRowIndex)
    .forEach((row) => {
      const obj: Record<string, unknown> = {};
      Object.entries(headers).forEach(([columnIndex, header]) => {
        const headerLabel = typeof header === "string" ? header.trim() : String(header ?? "").trim();
        if (!headerLabel) return;
        const colIdx = Number(columnIndex);
        obj[headerLabel] = row.cells[colIdx];
      });
      // Skip completely empty rows, but keep the original Excel row number for import keys.
      if (Object.values(obj).some((value) => value !== undefined && value !== null && String(value).trim() !== "")) {
        obj.__rowNumber = row.index;
        objects.push(obj);
      }
    });

  return objects;
}

export function parseXlsxTable(buffer: ArrayBuffer | Uint8Array, headerRowIndex = 8) {
  const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = parseCentralDirectory(data);
  const worksheetEntry = entries["xl/worksheets/sheet1.xml"];

  if (!worksheetEntry) {
    throw new Error("Planilha principal não encontrada (sheet1).");
  }

  const sharedStringsEntry = entries["xl/sharedStrings.xml"];
  const sharedStrings = sharedStringsEntry
    ? parseSharedStringsXml(decodeText(extractEntryData(data, sharedStringsEntry)))
    : [];

  const worksheetXml = decodeText(extractEntryData(data, worksheetEntry));
  const rows = parseWorksheetXml(worksheetXml, sharedStrings);
  return rowsToObjects(rows, headerRowIndex);
}

export function excelDateNumberToMillis(value: number): number {
  const EXCEL_EPOCH = Date.UTC(1899, 11, 30); // Excel serial 1 corresponds to 1900-01-01
  return EXCEL_EPOCH + value * 24 * 60 * 60 * 1000;
}
