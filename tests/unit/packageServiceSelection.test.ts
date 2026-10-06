import { describe, expect, it } from "vitest";

import { selectMissingFolderServices } from "@/lib/packageServiceSelection";

describe("selectMissingFolderServices", () => {
  it("carrega todos os serviços de subpacotes com mais de 110 itens", () => {
    const serviceIds = Array.from({ length: 120 }, (_, index) => `service-${index + 1}`);

    const selection = selectMissingFolderServices([serviceIds], [], 650);

    expect(selection.folderServiceIds).toHaveLength(120);
    expect(selection.missingServiceIds).toEqual(serviceIds);
    expect(selection.hasOverflow).toBe(false);
  });

  it("remove duplicados, ignora IDs já carregados e respeita o limite de segurança", () => {
    const selection = selectMissingFolderServices(
      [[" service-1 ", "service-2", "service-2"], ["service-3", ""]],
      ["service-1"],
      2,
    );

    expect(selection.folderServiceIds).toEqual(["service-1", "service-2", "service-3"]);
    expect(selection.missingServiceIds).toEqual(["service-2"]);
    expect(selection.hasOverflow).toBe(true);
  });
});
