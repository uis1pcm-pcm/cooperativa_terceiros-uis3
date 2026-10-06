export type PackageServiceExportRow = {
  os: string;
  tag: string;
  equipment: string;
  description: string;
  progress: number;
  company: string;
  startDate: string;
  endDate: string;
  totalHours: string;
  oc: string;
  dailyUpdates: Array<{
    date: string;
    description: string;
  }>;
};

const XML_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>`;

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textCell(value: string, styleId?: string): string {
  const style = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Cell${style}><Data ss:Type="String">${escapeXml(value)}</Data></Cell>`;
}

function progressCell(progress: number): string {
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  return `<Cell ss:StyleID="Percent"><Data ss:Type="Number">${safeProgress / 100}</Data></Cell>`;
}

export function buildPackageServicesExcel(rows: PackageServiceExportRow[]): string {
  const maximumDailyUpdates = rows.reduce((maximum, row) => Math.max(maximum, row.dailyUpdates.length), 0);
  const dailyHeaders = Array.from({ length: maximumDailyUpdates }, (_, index) => `Dia ${index + 1}`);
  const header = [
    "O.S",
    "TAG",
    "Equipamento",
    "Descrição do Serviço",
    "Porcentagem Atual",
    "Empresa",
    "O.C",
    "Data de Início",
    "Data de Fim",
    "Quantidade de Horas",
    ...dailyHeaders,
  ]
    .map((label) => textCell(label, "Header"))
    .join("");
  const body = rows
    .map((row) => {
      const dailyCells = Array.from({ length: maximumDailyUpdates }, (_, index) => {
        const update = row.dailyUpdates[index];
        if (!update) return textCell("", "DailyUpdate");
        return textCell(`Data: ${update.date}\nDescrição: ${update.description}`, "DailyUpdate");
      }).join("");
      return `<Row>${textCell(row.os)}${textCell(row.tag)}${textCell(row.equipment)}${textCell(row.description)}${progressCell(row.progress)}${textCell(row.company)}${textCell(row.oc)}${textCell(row.startDate)}${textCell(row.endDate)}${textCell(row.totalHours)}${dailyCells}</Row>`;
    })
    .join("");
  const dailyColumns = dailyHeaders.map(() => '<Column ss:Width="240"/>').join("");

  return `${XML_HEADER}
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#D9EAF7" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Percent"><NumberFormat ss:Format="0.00%"/></Style>
  <Style ss:ID="DailyUpdate"><Alignment ss:Vertical="Top" ss:WrapText="1"/></Style>
 </Styles>
 <Worksheet ss:Name="Andamento dos serviços">
  <Table>
   <Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="190"/><Column ss:Width="260"/><Column ss:Width="120"/><Column ss:Width="190"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="110"/><Column ss:Width="130"/>${dailyColumns}
   <Row>${header}</Row>${body}
  </Table>
 </Worksheet>
</Workbook>`;
}

export function buildPackageExcelFilename(packageLabel: string): string {
  const safeLabel = packageLabel
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `andamento-${safeLabel || "pacote"}.xls`;
}
