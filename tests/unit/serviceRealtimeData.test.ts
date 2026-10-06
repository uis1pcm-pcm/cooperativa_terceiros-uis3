import { describe, expect, it } from "vitest";

import { composeServiceRealtimeData } from "@/app/(pcm)/servicos/[id]/shared";

describe("composeServiceRealtimeData", () => {
  it("usa as datas legadas quando o documento principal contém datas vazias", () => {
    const service = composeServiceRealtimeData(
      { id: "service-1", plannedStart: "", plannedEnd: "" },
      { id: "service-1", plannedStart: "2026-08-01", plannedEnd: "2026-08-11" },
    );

    expect(service.plannedStart).toBe("2026-08-01");
    expect(service.plannedEnd).toBe("2026-08-11");
  });
});
