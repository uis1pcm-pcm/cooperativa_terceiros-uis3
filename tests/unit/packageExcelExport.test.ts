import { describe, expect, it } from "vitest";
import { buildPackageExcelFilename, buildPackageServicesExcel } from "@/lib/packageExcelExport";

describe("package Excel export", () => {
  it("exports one row per service in the requested column order", () => {
    const workbook = buildPackageServicesExcel([
      {
        os: "OS-10",
        tag: "TAG-2",
        equipment: "Bomba",
        description: "Troca do selo mecânico",
        progress: 42.5,
        company: "Empresa A",
        startDate: "01/09/2026",
        endDate: "10/09/2026",
        totalHours: "80.00",
        oc: "OC-100",
        dailyUpdates: [
          { date: "01/09/2026", description: "Desmontagem" },
          { date: "02/09/2026", description: "Montagem" },
        ],
      },
      {
        os: "OS-11",
        tag: "TAG-3",
        equipment: "Motor",
        description: "Revisão elétrica",
        progress: 100,
        company: "Empresa B",
        startDate: "02/09/2026",
        endDate: "03/09/2026",
        totalHours: "16.50",
        oc: "OC-200",
        dailyUpdates: [{ date: "03/09/2026", description: "Teste final" }],
      },
    ]);

    expect(workbook).toContain("O.S");
    expect(workbook).toContain("TAG");
    expect(workbook).toContain("Equipamento");
    expect(workbook).toContain("Descrição do Serviço");
    expect(workbook).toContain("Porcentagem Atual");
    expect(workbook).toContain("Empresa");
    expect(workbook).toContain("O.C");
    expect(workbook).toContain("Data de Início");
    expect(workbook).toContain("Data de Fim");
    expect(workbook).toContain("Quantidade de Horas");
    expect(workbook).toContain("Dia 1");
    expect(workbook).toContain("Dia 2");
    expect(workbook).toContain("Data: 01/09/2026\nDescrição: Desmontagem");
    expect(workbook).toContain("Data: 02/09/2026\nDescrição: Montagem");
    expect(workbook).toContain('<Data ss:Type="Number">0.425</Data>');
    expect(workbook.match(/<Row>/g)).toHaveLength(3);
    expect(workbook.indexOf("OS-10")).toBeLessThan(workbook.indexOf("TAG-2"));
    expect(workbook.indexOf("TAG-2")).toBeLessThan(workbook.indexOf("Bomba"));
    expect(workbook.indexOf("Bomba")).toBeLessThan(workbook.indexOf("Troca do selo mecânico"));
    expect(workbook.indexOf("Troca do selo mecânico")).toBeLessThan(workbook.indexOf("0.425"));
    expect(workbook.indexOf("O.C")).toBeLessThan(workbook.indexOf("Dia 1"));
    expect(workbook.indexOf("Empresa A")).toBeLessThan(workbook.indexOf("OC-100"));
    expect(workbook.indexOf("OC-100")).toBeLessThan(workbook.indexOf("01/09/2026"));
    expect(workbook.indexOf("01/09/2026")).toBeLessThan(workbook.indexOf("10/09/2026"));
    expect(workbook.indexOf("10/09/2026")).toBeLessThan(workbook.indexOf("80.00"));
    expect(workbook.indexOf("OC-100")).toBeLessThan(workbook.indexOf("Data: 01/09/2026"));
  });

  it("escapes spreadsheet content and creates a safe filename", () => {
    const workbook = buildPackageServicesExcel([
      {
        os: "A&B",
        tag: "<tag>",
        equipment: 'Equipamento "1"',
        description: "Inspeção & reparo",
        progress: 0,
        company: "A > B",
        startDate: "04/09/2026",
        endDate: "05/09/2026",
        totalHours: "8.00",
        oc: "OC & 1",
        dailyUpdates: [{ date: "04/09/2026", description: "Inspeção <inicial>" }],
      },
    ]);

    expect(workbook).toContain("A&amp;B");
    expect(workbook).toContain("&lt;tag&gt;");
    expect(workbook).toContain("Equipamento &quot;1&quot;");
    expect(workbook).toContain("Inspeção &amp; reparo");
    expect(workbook).toContain("A &gt; B");
    expect(workbook).toContain("OC &amp; 1");
    expect(workbook).toContain("Descrição: Inspeção &lt;inicial&gt;");
    expect(buildPackageExcelFilename("Pacote Ácido / 2026")).toBe("andamento-pacote-acido-2026.xls");
  });
});
