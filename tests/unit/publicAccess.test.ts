import { beforeEach, describe, expect, it, vi } from "vitest";

const { dbState } = vi.hoisted(() => ({
  dbState: {
    accessTokens: new Map<string, Record<string, unknown>>(),
    packageFolders: new Map<string, Record<string, unknown>>(),
    services: new Map<string, Record<string, unknown>>(),
  },
}));

vi.mock("@/lib/firebaseAdmin", () => ({
  getAdmin: () => ({
    db: {
      collection: (name: keyof typeof dbState) => ({
        doc: (id: string) => ({
          get: async () => {
            const data = dbState[name].get(id);
            return {
              id,
              exists: Boolean(data),
              data: () => data,
            };
          },
          collection: () => ({
            orderBy: () => ({
              get: async () => ({ docs: [] }),
            }),
          }),
        }),
      }),
    },
  }),
}));

import { requireServiceAccess } from "@/lib/public-access";

describe("public access", () => {
  beforeEach(() => {
    dbState.accessTokens.clear();
    dbState.packageFolders.clear();
    dbState.services.clear();
  });

  it("permite token de subpacote acessar serviço vinculado mesmo com empresa divergente no serviço", async () => {
    dbState.accessTokens.set("folder-token", {
      active: true,
      targetType: "folder",
      targetId: "folder-1",
      folderId: "folder-1",
      companyId: "empresa-a",
    });
    dbState.packageFolders.set("folder-1", {
      companyId: "empresa-a",
      services: ["service-1"],
    });
    dbState.services.set("service-1", {
      companyId: "empresa-legada-diferente",
      os: "OS-1",
      plannedStart: "2026-08-10",
      plannedEnd: "2026-08-12",
      totalHours: 10,
      status: "aberto",
    });

    await expect(requireServiceAccess("folder-token", "service-1")).resolves.toMatchObject({
      folderId: "folder-1",
      service: { id: "service-1" },
    });
  });

  it("mantém validação de empresa para token direto de serviço", async () => {
    dbState.accessTokens.set("service-token", {
      active: true,
      targetType: "service",
      targetId: "service-1",
      companyId: "empresa-a",
    });
    dbState.services.set("service-1", {
      companyId: "empresa-b",
      os: "OS-1",
      plannedStart: "2026-08-10",
      plannedEnd: "2026-08-12",
      totalHours: 10,
      status: "aberto",
    });

    await expect(requireServiceAccess("service-token", "service-1")).rejects.toMatchObject({
      status: 403,
      message: "Token não possui acesso a este serviço",
    });
  });

  it("expõe percentual e status canônicos apesar de resíduos legados em 100%", async () => {
    dbState.accessTokens.set("folder-token", {
      active: true,
      targetType: "folder",
      targetId: "folder-1",
      folderId: "folder-1",
    });
    dbState.packageFolders.set("folder-1", { services: ["service-1"] });
    dbState.services.set("service-1", {
      os: "2130834",
      plannedStart: "2026-08-10",
      plannedEnd: "2026-08-12",
      totalHours: 10,
      status: "Concluído",
      displayStatus: "Pendente",
      andamento: 95,
      previousProgress: 80,
      realPercent: 100,
      progress: 100,
      manualPercent: 100,
    });

    await expect(requireServiceAccess("folder-token", "service-1")).resolves.toMatchObject({
      service: {
        status: "Pendente",
        displayStatus: "Pendente",
        andamento: 95,
        realPercent: 95,
        progress: 95,
      },
    });
  });
});
