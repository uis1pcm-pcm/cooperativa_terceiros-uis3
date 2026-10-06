import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePcmUser: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  recomputeServiceProgress: vi.fn(),
}));

vi.mock("@/app/api/management/tokens/_lib/auth", () => ({
  HttpError: class HttpError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  requirePcmUser: mocks.requirePcmUser,
}));

vi.mock("@/lib/progressHistoryServer", () => ({
  recomputeServiceProgress: mocks.recomputeServiceProgress,
}));

vi.mock("@/lib/serverDb", () => ({
  AdminDbUnavailableError: class AdminDbUnavailableError extends Error {},
  getAdminDbOrThrow: () => ({
    collection: () => ({
      doc: () => ({
        collection: () => ({
          doc: () => ({ get: mocks.get, delete: mocks.delete, update: mocks.update }),
        }),
      }),
    }),
  }),
}));

vi.mock("@/lib/utils/firestoreErrors", () => ({ mapFirestoreError: () => null }));

vi.mock("firebase-admin/firestore", () => ({
  Timestamp: {
    fromDate: vi.fn(),
    now: vi.fn(),
  },
}));

import { DELETE, POST } from "@/app/api/pcm/servicos/update-progress-entry/route";

describe("DELETE /api/pcm/servicos/update-progress-entry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requirePcmUser.mockResolvedValue({ uid: "pcm-1" });
    mocks.get.mockResolvedValue({ exists: true });
    mocks.delete.mockResolvedValue(undefined);
    mocks.update.mockResolvedValue(undefined);
    mocks.recomputeServiceProgress.mockResolvedValue({ percent: 35 });
  });

  it.each(["updates", "serviceUpdates"] as const)(
    "sincroniza todos os aliases de percentual ao editar em %s",
    async (source) => {
      mocks.get.mockResolvedValue({ exists: true, data: () => ({ audit: { submittedBy: "terceiro" } }) });
      mocks.recomputeServiceProgress.mockResolvedValue({ percent: 42 });

      const request = new Request("http://localhost/api/pcm/servicos/update-progress-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId: "service-1",
          updateId: "update-1",
          source,
          date: "2026-09-18T12:00:00.000Z",
          percent: 42,
        }),
      });

      const response = await POST(request as never);

      expect(response.status).toBe(200);
      expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
        andamento: 42,
        manualPercent: 42,
        percent: 42,
        progress: 42,
        realPercent: 42,
        realPercentSnapshot: 42,
        totalPct: 42,
      }));
      expect(mocks.recomputeServiceProgress).toHaveBeenCalledWith("service-1");
    },
  );

  it("exclui o lançamento e recalcula o progresso do serviço", async () => {
    const request = new Request("http://localhost/api/pcm/servicos/update-progress-entry", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId: "service-1", updateId: "update-1", source: "updates" }),
    });

    const response = await DELETE(request as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, percent: 35 });
    expect(mocks.delete).toHaveBeenCalledOnce();
    expect(mocks.recomputeServiceProgress).toHaveBeenCalledWith("service-1");
  });

  it("não recalcula quando o lançamento não existe", async () => {
    mocks.get.mockResolvedValue({ exists: false });
    const request = new Request("http://localhost/api/pcm/servicos/update-progress-entry", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ serviceId: "service-1", updateId: "missing", source: "serviceUpdates" }),
    });

    const response = await DELETE(request as never);

    expect(response.status).toBe(404);
    expect(mocks.delete).not.toHaveBeenCalled();
    expect(mocks.recomputeServiceProgress).not.toHaveBeenCalled();
  });
});
