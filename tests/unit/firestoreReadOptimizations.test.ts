import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const state = vi.hoisted(() => ({
  canonicalFails: false,
  gets: [] as string[],
  writes: [] as Record<string, unknown>[],
  tags: [] as string[],
}));

function query(path: string) {
  const value = {
    where: vi.fn(() => value),
    orderBy: vi.fn(() => value),
    limit: vi.fn(() => value),
    get: vi.fn(async () => {
      state.gets.push(path);
      if (path === "services" && state.canonicalFails && state.gets.filter((item) => item === path).length === 1) {
        throw new Error("FAILED_PRECONDITION: index required");
      }
      return { docs: [], empty: true, size: 0 };
    }),
  };
  return value;
}

const db = {
  collection: vi.fn((name: string) => ({
    ...query(name),
    doc: vi.fn((id = "new-service") => ({
      id,
      set: vi.fn(async (data: Record<string, unknown>) => state.writes.push(data)),
      collection: vi.fn((child: string) => ({ ...query(`${name}/${id}/${child}`), doc: vi.fn() })),
    })),
  })),
};

vi.mock("@/lib/firebaseAdmin", () => ({ getAdmin: () => ({ db }) }));
vi.mock("next/cache", () => ({
  unstable_cache: (fn: (...args: unknown[]) => unknown) => fn,
  revalidateTag: (tag: string) => state.tags.push(tag),
}));
vi.mock("@/lib/progressHistoryServer", () => ({ recomputeServiceProgress: vi.fn() }));

import { createService, listAvailableOpenServices, listUpdates } from "@/lib/repo/services";

beforeEach(() => {
  state.canonicalFails = false;
  state.gets.length = 0;
  state.writes.length = 0;
  state.tags.length = 0;
});

describe("otimizações de leituras Firestore", () => {
  it("retorna após a query canônica sem executar fallback nem ler packageFolders", async () => {
    await listAvailableOpenServices(200, { disableCache: true });
    expect(state.gets).toEqual(["services"]);
    expect(state.gets).not.toContain("packageFolders");
  });

  it("executa fallback e consulta packageFolders somente quando a query canônica falha", async () => {
    state.canonicalFails = true;
    await listAvailableOpenServices(200, { disableCache: true });
    expect(state.gets.filter((path) => path === "services").length).toBeGreaterThan(1);
    expect(state.gets).toContain("packageFolders");
  });

  it.each([
    [false, ["services/A/updates"]],
    [true, ["services/A/updates", "services/A/serviceUpdates"]],
    [undefined, ["services/A/updates", "services/A/serviceUpdates"]],
  ])("respeita o marcador legado %s", async (marker, expected) => {
    await listUpdates("A", 200, marker);
    expect(state.gets).toEqual(expected);
  });

  it("cria serviços modernos com marcador legado falso", async () => {
    await createService({
      os: "OS-1", oc: null, tag: "", equipamento: "Equipamento", setor: null,
      inicioPrevistoMillis: 1, fimPrevistoMillis: 2, horasPrevistas: 1,
      empresaId: null, cnpj: null, status: "Aberto", checklist: [],
    });
    expect(state.writes[0]?.hasLegacyServiceUpdates).toBe(false);
  });

  it("mantém cache de disponíveis na página e backfill com consulta limit(1)", () => {
    const page = readFileSync("src/app/(pcm)/pacotes/[id]/page.tsx", "utf8");
    const backfill = readFileSync("scripts/backfill-legacy-service-updates.ts", "utf8");
    expect(page).toContain('listAvailableOpenServices(200, { mode: "summary" })');
    expect(page).not.toContain('mode: "summary", disableCache: true');
    expect(backfill).toContain('collection("serviceUpdates").limit(1).get()');
    expect(backfill).toContain("FIRESTORE_SAFE_BATCH_WRITES");
  });

  it("recarrega o histórico canônico mesmo quando existe um snapshot embutido", () => {
    const page = readFileSync("src/app/(pcm)/pacotes/[id]/page.tsx", "utf8");
    expect(page).toContain("for (let i = 0; i < services.length; i += chunkSize)");
    expect(page).not.toContain("servicesMissingUpdates");
  });

  it("usa tags de update específicas e não mantém invalidação global", () => {
    const source = readFileSync("src/lib/repo/services.ts", "utf8");
    expect(source).toContain("`service:${serviceId}:updates`");
    expect(source).toContain("`service:${serviceId}:legacy-updates`");
    expect(source).not.toContain('revalidateTag("services:updates")');
    expect(source).not.toContain('revalidateTag("services:legacy-updates")');
  });
});
