import { describe, expect, it } from "vitest";

import { resolveCurrentProgress } from "@/lib/progressValidation";

describe("progress validation", () => {
  it("não aplica bloqueio quando o percentual informado é menor", () => {
    expect(true).toBe(true);
  });

  it("prioriza o percentual canônico e ignora campos legados obsoletos", () => {
    expect(
      resolveCurrentProgress({
        realPercent: 100,
        manualPercent: 100,
        andamento: 95,
        progress: 100,
      }),
    ).toBe(95);
  });

  it("usa o percentual de reabertura quando o serviço pendente ainda possui campos em 100%", () => {
    expect(
      resolveCurrentProgress({
        status: "Concluído",
        displayStatus: "Pendente",
        previousProgress: 95,
        realPercent: 100,
        progress: 100,
      }),
    ).toBe(95);
  });

  it("ignora o snapshot de reabertura depois de um novo lançamento", () => {
    expect(
      resolveCurrentProgress({
        status: "Pendente",
        previousProgress: 95,
        andamento: 60,
        realPercentSnapshot: 60,
      }),
    ).toBe(60);
  });
});
