import { describe, expect, it } from "vitest";

import {
  calcularPercentualSubpacote,
  calcularPercentualRealizadoSubpacote,
  calcularPercentualPlanejadoPacote,
  calcularPercentualRealizadoPacote,
  calcularPercentualPlanejadoServico,
  calcularCurvaSPlanejada,
  calcularCurvaSRealizada,
  calcularIndicadoresCurvaS,
  calcularMetricasSubpacote,
  clampProgress,
  mapearServicosPlanejados,
  obterIntervaloSubpacote,
  resolveReopenedProgress,
  resolveServicoPercentualPlanejado,
  resolveServicoRealPercent,
  snapshotBeforeConclusion,
  toDate,
} from "@/lib/serviceProgress";
import { realizedFromUpdates } from "@/lib/curve";
import { buildRealizedSeries } from "@/app/(pcm)/servicos/[id]/shared";
import { formatDayKey } from "@/lib/formatDateTime";
import { DEFAULT_TIME_ZONE, resolveReferenceDate } from "@/lib/referenceDate";

describe("serviceProgress utilities", () => {
  describe("calcularMetricasSubpacote", () => {
    it("recalcula o planejado quando as datas do serviço são alteradas", () => {
      const baseService = {
        id: "service-1",
        os: "OS-1",
        folderId: "folder-1",
        folderName: "Subpacote 1",
        totalHours: 10,
        status: "Aberto" as const,
        createdAt: Date.parse("2025-01-01"),
      };
      const reference = "2025-01-06";

      const original = calcularMetricasSubpacote(
        [{ ...baseService, plannedStart: "2025-01-01", plannedEnd: "2025-01-11" }],
        reference,
      );
      const changed = calcularMetricasSubpacote(
        [{ ...baseService, plannedStart: "2025-01-05", plannedEnd: "2025-01-15" }],
        reference,
      );

      expect(original[0].plannedPercent).toBe(54.55);
      expect(changed[0].plannedPercent).toBe(18.18);
      expect(changed[0].horasQueDeveriamEstar).toBe(1.82);
    });

    it("preserva variações menores que 1% em subpacotes grandes", () => {
      const services = Array.from({ length: 120 }, (_, index) => ({
        id: `service-${index}`,
        os: `OS-${index}`,
        folderId: "folder-1",
        folderName: "Subpacote grande",
        totalHours: 1,
        status: "Aberto" as const,
        createdAt: Date.parse("2025-01-01"),
        plannedStart: index === 0 ? "2025-01-05" : "2025-01-01",
        plannedEnd: index === 0 ? "2025-01-15" : "2025-01-11",
      }));

      const [metric] = calcularMetricasSubpacote(services, "2025-01-06");

      expect(metric.plannedPercent).toBe(54.24);
      expect(metric.plannedPercent).not.toBe(Math.round(metric.plannedPercent));
    });

    it("mantém o percentual atual ao alterar somente a data de referência", () => {
      const services = [
        {
          id: "service-1",
          os: "OS-1",
          folderId: "folder-1",
          folderName: "Subpacote 1",
          totalHours: 10,
          status: "Aberto" as const,
          createdAt: Date.parse("2025-01-01"),
          plannedStart: "2025-01-01",
          plannedEnd: "2025-01-11",
          updates: [
            {
              id: "update-1",
              date: "2025-01-02",
              createdAt: Date.parse("2025-01-02"),
              percent: 20,
              description: "",
            },
            {
              id: "update-2",
              date: "2025-01-09",
              createdAt: Date.parse("2025-01-09"),
              percent: 80,
              description: "",
            },
          ],
        },
      ];

      const [earlyReference] = calcularMetricasSubpacote(services, "2025-01-03");
      const [lateReference] = calcularMetricasSubpacote(services, "2025-01-10");

      expect(earlyReference.realizedPercent).toBe(80);
      expect(lateReference.realizedPercent).toBe(80);
      expect(earlyReference.plannedPercent).not.toBe(lateReference.plannedPercent);
    });
  });

  it("parses dd/MM/yyyy date-only strings for updates and ranges", () => {
    const date = toDate("17/11/2025");
    expect(date?.toISOString()).toBe("2025-11-17T00:00:00.000Z");
  });

  it("parses Portuguese month names for reportDate-like values", () => {
    const date = toDate("20 de novembro de 2025 às 09:00");
    expect(date?.toISOString()).toBe("2025-11-20T00:00:00.000Z");
  });

  it("clamps progress to 0-100 range", () => {
    expect(clampProgress(-10)).toBe(0);
    expect(clampProgress(42.6)).toBe(42.6);
    expect(clampProgress(180)).toBe(100);
  });

  it("uses reportDate before createdAt when selecting the latest realized update", () => {
    const updates = [
      {
        id: "oldest-by-created",
        createdAt: new Date("2025-08-10T12:00:00Z").getTime(),
        submittedAt: new Date("2025-08-10T12:00:00Z").getTime(),
        date: new Date("2025-08-12T00:00:00Z").getTime(),
        percent: 30,
        description: "",
      },
      {
        id: "newer-by-created",
        createdAt: new Date("2025-08-13T09:00:00Z").getTime(),
        submittedAt: new Date("2025-08-13T09:00:00Z").getTime(),
        date: new Date("2025-08-11T00:00:00Z").getTime(),
        percent: 20,
        description: "",
      },
    ] as any;

    expect(realizedFromUpdates(updates)).toBe(30);
  });

  it("places realized curve points on the third-party selected report date", () => {
    const series = buildRealizedSeries({
      planned: [
        { date: "2026-08-12", percent: 0 },
        { date: "2026-08-13", percent: 100 },
      ],
      realizedPercent: 20,
      updates: [
        {
          id: "late-submission",
          createdAt: new Date("2026-08-13T10:13:23Z").getTime(),
          submittedAt: new Date("2026-08-13T10:13:26Z").getTime(),
          date: new Date("2026-08-12T12:00:00Z").getTime(),
          percent: 20,
          realPercentSnapshot: 20,
          description: "Retirada dos rolamentos",
        },
      ] as any,
    });

    expect(series).toEqual([{ date: "2026-08-12", percent: 20 }]);
  });

  it("keeps the highest realized percentage when there are multiple entries on the same day", () => {
    const series = buildRealizedSeries({
      planned: [{ date: "2026-08-12", percent: 100 }],
      realizedPercent: 20,
      updates: [
        {
          id: "higher-earlier-entry",
          submittedAt: new Date("2026-08-12T09:00:00Z").getTime(),
          date: new Date("2026-08-12T00:00:00Z").getTime(),
          percent: 60,
        },
        {
          id: "lower-later-entry",
          submittedAt: new Date("2026-08-12T15:00:00Z").getTime(),
          date: new Date("2026-08-12T00:00:00Z").getTime(),
          percent: 20,
        },
      ] as any,
    });

    expect(series).toEqual([{ date: "2026-08-12", percent: 60 }]);
  });

  it("selects snapshot before conclusion preferring values below 100", () => {
    expect(snapshotBeforeConclusion(67, null)).toBe(67);
    expect(snapshotBeforeConclusion(100, 80)).toBe(80);
    expect(snapshotBeforeConclusion(100, 150)).toBe(0);
  });

  it("resolves reopened progress using stored values and history", () => {
    const target = resolveReopenedProgress({
      requested: null,
      previousStored: 72,
      history: [null, 55, 100],
      current: 100,
    });
    expect(target).toBe(72);
  });

  it("falls back to history when stored value is missing", () => {
    const target = resolveReopenedProgress({
      requested: null,
      previousStored: null,
      history: [null, 48, 100],
      current: 100,
    });
    expect(target).toBe(48);
  });

  it("returns zero when no candidate is available", () => {
    const target = resolveReopenedProgress({
      requested: null,
      previousStored: null,
      history: [null],
      current: 100,
    });
    expect(target).toBe(0);
  });

  describe("resolveServicoRealPercent", () => {
    it("prefers the last percentual update when available", () => {
      const percent = resolveServicoRealPercent({
        updates: [
          { percentual: 20, data: "2024-01-01" },
          { percentualReal: 65, dataAtualizacaoPercentual: "2024-01-05" },
        ],
      });

      expect(percent).toBe(65);
    });

    it("reads direct percentual fields when there is no history", () => {
      const percent = resolveServicoRealPercent({ percentualInformado: "37.2" });
      expect(percent).toBe(37.2);
    });

    it("clamps invalid or out of range values", () => {
      expect(resolveServicoRealPercent({ progress: 150 })).toBe(100);
      expect(resolveServicoRealPercent({ progress: -20 })).toBe(0);
    });

    it("restores the stored progress when reopening a pending service", () => {
      const percent = resolveServicoRealPercent({
        status: "pendente",
        previousProgress: 37,
        progress: 100,
        updates: [
          { percentual: 80, data: "2024-01-01" },
          { percentual: 100, data: "2024-01-02" },
        ],
      });

      expect(percent).toBe(37);
    });

    it("ignores the reopening snapshot after a new progress entry", () => {
      const percent = resolveServicoRealPercent({
        status: "pendente",
        previousProgress: 95,
        progress: 60,
        realPercentSnapshot: 60,
        updates: [
          { percentual: 95, data: "2026-09-16" },
          { percentual: 60, data: "2026-09-18" },
        ],
      });

      expect(percent).toBe(60);
    });
  });

  describe("resolveServicoPercentualPlanejado", () => {
    it("falls back to the planned subpackage when the service lacks dates", () => {
      const reference = new Date("2024-01-04T00:00:00Z");
      const percent = resolveServicoPercentualPlanejado(
        {
          subpacotePlanejado: {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: new Date("2024-01-01T00:00:00Z"),
                dataFim: new Date("2024-01-06T00:00:00Z"),
              },
            ],
          },
        },
        reference,
      );

      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThan(100);
    });

    it("uses the matching subpackage inside a planned package", () => {
      const reference = new Date("2024-02-02T00:00:00Z");
      const percent = resolveServicoPercentualPlanejado(
        {
          pacotePlanejado: {
            subpacotes: [
              {
                id: "folder-b",
                servicos: [
                  {
                    horasPrevistas: 10,
                    dataInicio: new Date("2024-01-01T00:00:00Z"),
                    dataFim: new Date("2024-01-11T00:00:00Z"),
                  },
                ],
              },
              {
                id: "folder-a",
                servicos: [
                  {
                    horasPrevistas: 5,
                    dataInicio: new Date("2024-02-01T00:00:00Z"),
                    dataFim: new Date("2024-02-06T00:00:00Z"),
                  },
                ],
              },
            ],
          },
          subpacoteId: "folder-a",
        },
        reference,
      );

      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThanOrEqual(100);
    });
  });

  describe("calcularPercentualSubpacote", () => {
    const reference = new Date("2024-01-06T00:00:00Z");

    it("returns zero when there are no valid services", () => {
      expect(calcularPercentualSubpacote({ servicos: [] }, reference)).toBe(0);
      expect(
        calcularPercentualSubpacote(
          {
            servicos: [
              { horasPrevistas: 10, dataInicio: "2024-01-10", dataFim: "2024-01-01" },
              { horasPrevistas: 5 },
            ],
          },
          reference,
        ),
      ).toBe(0);
    });

    it("calculates weighted average progress using hours", () => {
      const percentual = calcularPercentualSubpacote(
        {
          servicos: [
            {
              horasPrevistas: 10,
              dataInicio: new Date("2024-01-01T00:00:00Z"),
              dataFim: new Date("2024-01-11T00:00:00Z"),
            },
            {
              horasPrevistas: 5,
              dataInicio: new Date("2024-01-01T00:00:00Z"),
              dataFim: new Date("2024-01-06T00:00:00Z"),
            },
          ],
        },
        reference,
      );
      // Contagem inclusiva de dias:
      // Serviço 1: 01/01..11/01 (11 dias), ref 06/01 => 6/11 = 54.545...
      // Serviço 2: 01/01..06/01 (6 dias), ref no fim => 100%
      expect(percentual).toBeCloseTo(((6 / 11) * 100 * 10 + 100 * 5) / 15, 5);
    });

    it("clamps the final percentage between 0 and 100", () => {
      const percentual = calcularPercentualSubpacote(
        {
          servicos: [
            {
              horasPrevistas: 8,
              dataInicio: new Date("2024-01-01T00:00:00Z"),
              dataFim: new Date("2024-01-04T00:00:00Z"),
            },
            {
              horasPrevistas: 4,
              dataInicio: new Date("2024-01-02T00:00:00Z"),
              dataFim: new Date("2024-01-05T00:00:00Z"),
            },
          ],
        },
        new Date("2024-01-20T00:00:00Z"),
      );
      expect(percentual).toBe(100);
    });
  });

  describe("calcularPercentualPlanejadoPacote e calcularPercentualRealizadoPacote", () => {
    const reference = new Date("2024-11-24T00:00:00Z");

    it("applies hour-based weights across subpackages for planned progress", () => {
      const percentual = calcularPercentualPlanejadoPacote(
        {
          subpacotes: [
            {
              servicos: [
                { horasPrevistas: 10, dataInicio: "2024-11-20", dataFim: "2024-11-30" },
              ],
            },
            {
              servicos: [
                { horasPrevistas: 30, dataInicio: "2024-11-20", dataFim: "2024-12-20" },
              ],
            },
          ],
        },
        reference,
      );

      // Contagem inclusiva de dias:
      // Serviço 1: 20/11..30/11 (11 dias), ref 24/11 => 5/11 = 45.454...
      // Serviço 2: 20/11..20/12 (31 dias), ref 24/11 => 5/31 = 16.129...
      expect(percentual).toBeCloseTo(((5 / 11) * 100 * 10 + (5 / 31) * 100 * 30) / 40, 5);
    });

    it("applies hour-based weights across subpackages for realized progress", () => {
      const percentual = calcularPercentualRealizadoPacote(
        {
          subpacotes: [
            {
              servicos: [
                {
                  horasPrevistas: 10,
                  dataInicio: "2024-11-20",
                  dataFim: "2024-11-30",
                  atualizacoes: [
                    { data: "2024-11-22", percentual: 25 },
                    { data: "2024-11-24", percentual: 50 },
                  ],
                },
              ],
            },
            {
              servicos: [
                {
                  horasPrevistas: 30,
                  dataInicio: "2024-11-20",
                  dataFim: "2024-12-20",
                  atualizacoes: [
                    { data: "2024-11-23", percentual: 10 },
                    { data: "2024-11-24", percentual: 20 },
                  ],
                },
              ],
            },
          ],
        },
        reference,
      );

      expect(percentual).toBeCloseTo((50 * 10 + 20 * 30) / 40, 5);
    });
  });

  describe("calcularPercentualRealizadoSubpacote", () => {
    const reference = new Date("2024-01-05T00:00:00Z");

    it("returns zero when no services contribute hours", () => {
      expect(calcularPercentualRealizadoSubpacote({ servicos: [] }, reference)).toBe(0);
      expect(
        calcularPercentualRealizadoSubpacote(
          {
            servicos: [
              { horasPrevistas: 0, dataInicio: "2024-01-01", dataFim: "2024-01-10" },
              { horasPrevistas: null },
            ],
          },
          reference,
        ),
      ).toBe(0);
    });

    it("calculates weighted real progress based on the latest updates", () => {
      const percentual = calcularPercentualRealizadoSubpacote(
        {
          servicos: [
            {
              horasPrevistas: 10,
              dataInicio: "2024-01-01",
              dataFim: "2024-01-06",
              atualizacoes: [
                { data: "2024-01-02", percentual: 20 },
                { data: "2024-01-05", percentual: 40 },
                { data: "2024-01-07", percentual: 80 },
              ],
            },
            {
              horasPrevistas: 5,
              dataInicio: "2024-01-01",
              dataFim: "2024-01-10",
              atualizacoes: [
                { data: "2024-01-03", percentual: 10 },
                { data: "2024-01-04", percentual: 50 },
              ],
            },
          ],
        },
        reference,
      );
      expect(percentual).toBeCloseTo((40 * 10 + 50 * 5) / 15, 5);
    });

    it("treats missing updates as zero progress", () => {
      const percentual = calcularPercentualRealizadoSubpacote(
        {
          servicos: [
            { horasPrevistas: 8, dataInicio: "2024-01-01", dataFim: "2024-01-05" },
            {
              horasPrevistas: 4,
              dataInicio: "2024-01-02",
              dataFim: "2024-01-06",
              atualizacoes: [{ data: "2024-01-04", percentual: 75 }],
            },
          ],
        },
        reference,
      );
      expect(percentual).toBeCloseTo((0 * 8 + 75 * 4) / 12, 5);
    });
  });

  describe("calcularPercentualPlanejadoServico", () => {
    const reference = new Date("2024-01-10T00:00:00Z");

    it("returns zero when reference is before start", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-15T00:00:00Z"),
          dataFim: new Date("2024-01-25T00:00:00Z"),
        },
        reference,
      );
      expect(percentual).toBe(0);
    });

    it("returns zero progress at the start milestone", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-10T00:00:00Z"),
          dataFim: new Date("2024-01-20T00:00:00Z"),
        },
        new Date("2024-01-10T00:00:00Z"),
      );
      expect(percentual).toBe(0);
    });

    it("returns one hundred when reference is after finish", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-01T00:00:00Z"),
          dataFim: new Date("2024-01-05T00:00:00Z"),
        },
        reference,
      );
      expect(percentual).toBe(100);
    });

    it("calculates proportional progress when inside the interval", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-01T00:00:00Z"),
          dataFim: new Date("2024-01-11T00:00:00Z"),
        },
        reference,
      );
      // Start date counts as 0% and end date counts as 100% for the planned curve.
      expect(percentual).toBeCloseTo(90, 5);
    });

    it("prefers plannedDaily series when available", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-01T00:00:00Z"),
          dataFim: new Date("2024-01-03T00:00:00Z"),
          plannedDaily: [0, 35, 80],
        },
        new Date("2024-01-02T12:00:00Z"),
      );
      expect(percentual).toBe(35);
    });

    it("returns 100 after the plannedDaily schedule ends", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-01T00:00:00Z"),
          dataFim: new Date("2024-01-03T00:00:00Z"),
          plannedDaily: [0, 50, 60],
        },
        new Date("2024-01-05T00:00:00Z"),
      );
      expect(percentual).toBe(100);
    });

    it("falls back to the linear calculation when plannedDaily length mismatches", () => {
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2024-01-01T00:00:00Z"),
          dataFim: new Date("2024-01-04T00:00:00Z"),
          plannedDaily: [0, 50],
        },
        new Date("2024-01-03T00:00:00Z"),
      );
      expect(percentual).toBeGreaterThan(0);
      expect(percentual).toBeLessThan(100);
    });

    it("returns zero for invalid dates", () => {
      expect(
        calcularPercentualPlanejadoServico(
          {
            dataInicio: new Date("2024-01-05T00:00:00Z"),
            dataFim: new Date("2024-01-05T00:00:00Z"),
          },
          reference,
        ),
      ).toBe(0);
    });

    it("handles mid-interval references using the selected date", () => {
      const { date: referenceDate } = resolveReferenceDate("2025-11-24");
      const percentual = calcularPercentualPlanejadoServico(
        {
          dataInicio: new Date("2025-11-20T00:00:00Z"),
          dataFim: new Date("2025-11-29T00:00:00Z"),
        },
        referenceDate,
      );

      expect(percentual).toBeCloseTo((4 / 9) * 100, 5);
    });
  });

  describe("mapearServicosPlanejados", () => {
    it("maps planned and real percentages for each service", () => {
      const reference = new Date("2024-01-06T00:00:00Z");
      const result = mapearServicosPlanejados(
        [
          {
            id: "abc",
            descricao: "Serviço 1",
            dataInicio: new Date("2024-01-01T00:00:00Z"),
            dataFim: new Date("2024-01-11T00:00:00Z"),
            percentualRealAtual: 55,
          },
          {
            id: 2,
            description: "Serviço 2",
            dataInicio: new Date("2024-01-05T00:00:00Z"),
            dataFim: new Date("2024-01-15T00:00:00Z"),
            percentualRealAtual: "150",
          },
        ],
        reference,
      );

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ id: "abc", descricao: "Serviço 1", percentualReal: 55 });
      expect(result[0].percentualPlanejado).toBeCloseTo(50, 5);
      expect(result[1]).toMatchObject({ id: "2", descricao: "Serviço 2", percentualReal: 100 });
      expect(result[1].percentualPlanejado).toBeCloseTo(10, 5);
    });

    it("returns zero when real percentage is missing", () => {
      const reference = new Date("2024-01-06T00:00:00Z");
      const result = mapearServicosPlanejados(
        [
          {
            id: "abc",
            descricao: "Serviço 1",
            dataInicio: new Date("2024-01-01T00:00:00Z"),
            dataFim: new Date("2024-01-11T00:00:00Z"),
            percentualRealAtual: null,
          },
        ],
        reference,
      );

      expect(result[0]).toMatchObject({ percentualReal: 0 });
    });
  });

  describe("Curva S consolidada", () => {
    const servicoA = {
      id: "A",
      horasPrevistas: 10,
      dataInicio: new Date("2024-01-01T00:00:00Z"),
      dataFim: new Date("2024-01-05T00:00:00Z"),
      atualizacoes: [
        { data: new Date("2024-01-02T00:00:00Z"), percentual: 20 },
        { data: new Date("2024-01-04T00:00:00Z"), percentual: 60 },
      ],
    };
    const servicoB = {
      id: "B",
      horasPrevistas: 5,
      dataInicio: new Date("2024-01-03T00:00:00Z"),
      dataFim: new Date("2024-01-07T00:00:00Z"),
      atualizacoes: [{ data: new Date("2024-01-05T00:00:00Z"), percentual: 40 }],
    };
    const pacoteCurva = {
      subpacotes: [{ servicos: [servicoA] }, { services: [servicoB] }],
      servicos: [
        {
          horasPrevistas: 100,
          dataInicio: new Date("2023-12-01T00:00:00Z"),
          dataFim: new Date("2024-02-01T00:00:00Z"),
          atualizacoes: [{ data: new Date("2023-12-15T00:00:00Z"), percentual: 100 }],
        },
      ],
    };

    const obterPercentual = (curva: { data: Date; percentual: number }[], iso: string) => {
      const alvo = formatDayKey(new Date(iso), { timeZone: DEFAULT_TIME_ZONE });
      const ponto = curva.find(
        (item) => formatDayKey(item.data, { timeZone: DEFAULT_TIME_ZONE }) === alvo,
      );
      if (!ponto) {
        throw new Error(`Ponto não encontrado para ${iso}`);
      }
      return ponto.percentual;
    };

    it("monta a curva planejada apenas com os serviços de subpacotes", () => {
      const curvaPlanejada = calcularCurvaSPlanejada(pacoteCurva);
      expect(curvaPlanejada).toHaveLength(7);
      expect(
        formatDayKey(curvaPlanejada[0].data, { timeZone: DEFAULT_TIME_ZONE }),
      ).toBe("2024-01-01");
      expect(
        formatDayKey(curvaPlanejada[curvaPlanejada.length - 1].data, {
          timeZone: DEFAULT_TIME_ZONE,
        }),
      ).toBe("2024-01-07");
      expect(obterPercentual(curvaPlanejada, "2024-01-03T00:00:00Z")).toBeCloseTo(
        (60 * 10 + 20 * 5) / 15,
        1,
      );
    });

    it("usa o histórico do Terceiro para calcular a curva realizada", () => {
      const curvaRealizada = calcularCurvaSRealizada(pacoteCurva);
      expect(obterPercentual(curvaRealizada, "2024-01-01T00:00:00Z")).toBe(0);
      expect(obterPercentual(curvaRealizada, "2024-01-04T00:00:00Z")).toBeCloseTo(40, 1);
    });

    it("calcula os indicadores consolidados com base nas curvas", () => {
      const indicadores = calcularIndicadoresCurvaS(
        pacoteCurva,
        new Date("2024-01-05T00:00:00Z"),
      );
      expect(indicadores.planejadoTotal).toBe(100);
      expect(indicadores.planejadoAteHoje).toBeCloseTo(87, 1);
      // `calcularIndicadoresCurvaS` arredonda os valores consolidados.
      expect(indicadores.realizado).toBe(53);
      expect(indicadores.diferenca).toBe(-34);
    });

    it("prioriza reportDate sobre createdAt ao montar a curva realizada", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: "2025-12-27",
                dataFim: "2025-12-31",
                updates: [
                  { percentual: 30, reportDate: "28/12/2025", createdAt: "2025-12-29" },
                  { percentual: 40, reportDate: "31/12/2025", createdAt: "2025-12-29" },
                ],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(obterPercentual(curva, "2025-12-28T00:00:00Z")).toBe(30);
      expect(obterPercentual(curva, "2025-12-31T00:00:00Z")).toBe(40);
    });

    it("usa o maior lançamento do dia na curva realizada do pacote", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: "2025-12-27",
                dataFim: "2025-12-31",
                updates: [
                  { percentual: 70, reportDate: "29/12/2025", createdAt: "2025-12-29T09:00:00Z" },
                  { percentual: 35, reportDate: "29/12/2025", createdAt: "2025-12-29T15:00:00Z" },
                ],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(obterPercentual(curva, "2025-12-29T00:00:00Z")).toBe(70);
    });

    it("aceita reportDateMillis como data efetiva das atualizações", () => {
      const reportDateMillis = new Date("2025-03-02T00:00:00Z").getTime();
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: "2025-03-01",
                dataFim: "2025-03-04",
                updates: [{ percentual: 35, reportDateMillis, createdAt: "2025-03-05" }],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(obterPercentual(curva, "2025-03-02T00:00:00Z")).toBe(35);
    });

    it("aplica reportDate em múltiplos serviços e subpacotes", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 8,
                dataInicio: "2025-01-01",
                dataFim: "2025-01-04",
                updates: [{ percentual: 20, reportDate: "2025-01-02", createdAt: "2025-01-03" }],
              },
            ],
          },
          {
            servicos: [
              {
                horasPrevistas: 12,
                dataInicio: "2025-01-01",
                dataFim: "2025-01-04",
                updates: [{ percentual: 60, reportDate: "2025-01-03", createdAt: "2025-01-04" }],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(obterPercentual(curva, "2025-01-02T00:00:00Z")).toBeCloseTo(8);
      expect(obterPercentual(curva, "2025-01-03T00:00:00Z")).toBeCloseTo(44);
    });


    it("ignora updatedAt da O.S ao posicionar a curva realizada do pacote", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: "2026-08-12",
                dataFim: "2026-08-13",
                percentualRealAtual: 90,
                updatedAt: "2026-08-13",
                updates: [
                  {
                    percentual: 20,
                    reportDate: "2026-08-12",
                    createdAt: "2026-08-13",
                    updatedAt: "2026-08-13",
                  },
                ],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(obterPercentual(curva, "2026-08-12T00:00:00Z")).toBe(20);
      expect(
        curva.some((ponto) => formatDayKey(ponto.data, { timeZone: DEFAULT_TIME_ZONE }) === "2026-08-13"),
      ).toBe(false);
    });

    it("não transforma updatedAt isolado em lançamento realizado", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: "2026-08-12",
                dataFim: "2026-08-13",
                percentualRealAtual: 75,
                updatedAt: "2026-08-13",
                updates: [{ percentual: 75, updatedAt: "2026-08-13" }],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(curva.every((ponto) => ponto.percentual === 0)).toBe(true);
    });

    it("mantém fallback para atualizações legadas sem reportDate", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 6,
                dataInicio: "2025-02-01",
                dataFim: "2025-02-03",
                updates: [{ percentual: 55, createdAt: "2025-02-02" }],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);
      expect(obterPercentual(curva, "2025-02-02T00:00:00Z")).toBe(55);
    });

    it("não antecipa o início da curva realizada para lançamentos antes do início planejado", () => {
      const pacote = {
        subpacotes: [
          {
            servicos: [
              {
                horasPrevistas: 10,
                dataInicio: "2026-08-10",
                dataFim: "2026-08-12",
                updates: [{ percentual: 30, reportDate: "2026-08-08", createdAt: "2026-08-08" }],
              },
            ],
          },
        ],
      };

      const curva = calcularCurvaSRealizada(pacote);

      expect(formatDayKey(curva[0].data, { timeZone: DEFAULT_TIME_ZONE })).toBe("2026-08-10");
      expect(curva.map((ponto) => formatDayKey(ponto.data, { timeZone: DEFAULT_TIME_ZONE }))).not.toContain(
        "2026-08-08",
      );
      expect(curva[0].percentual).toBe(30);
    });
  });

  describe("obterIntervaloSubpacote", () => {
    it("returns the earliest start and latest finish across services", () => {
      const intervalo = obterIntervaloSubpacote({
        servicos: [
          { horasPrevistas: 5, dataInicio: "2024-02-10", dataFim: "2024-02-20" },
          { horasPrevistas: 5, dataInicio: "2024-02-01", dataFim: "2024-03-01" },
        ],
      });
      expect(intervalo.inicio?.toISOString()).toBe(new Date("2024-02-01T00:00:00.000Z").toISOString());
      expect(intervalo.fim?.toISOString()).toBe(new Date("2024-03-01T00:00:00.000Z").toISOString());
    });

    it("falls back to null values when there are no valid ranges", () => {
      const intervalo = obterIntervaloSubpacote({ servicos: [{ horasPrevistas: 5 }] });
      expect(intervalo.inicio).toBeNull();
      expect(intervalo.fim).toBeNull();
    });
  });
});
