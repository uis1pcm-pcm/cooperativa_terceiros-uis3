import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireServiceAccess: vi.fn(),
  updateChecklistProgress: vi.fn(),
  addComputedUpdate: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "TOKEN" }) }),
}));

vi.mock("@/lib/public-access", () => ({
  PublicAccessError: class PublicAccessError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
  requireServiceAccess: mocks.requireServiceAccess,
}));

vi.mock("@/lib/repo/services", () => ({
  updateChecklistProgress: mocks.updateChecklistProgress,
  addComputedUpdate: mocks.addComputedUpdate,
}));

vi.mock("@/lib/utils/firestoreErrors", () => ({ mapFirestoreError: () => null }));

import { POST } from "@/app/api/public/service/update-checklist/route";

describe("POST /api/public/service/update-checklist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireServiceAccess.mockResolvedValue({ service: { id: "service-1" } });
    mocks.updateChecklistProgress.mockResolvedValue(60);
    mocks.addComputedUpdate.mockResolvedValue("update-1");
  });

  function request(recordUpdate?: boolean) {
    return new Request("http://localhost/api/public/service/update-checklist?serviceId=service-1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        updates: [{ id: "item-1", progress: 60, status: "andamento" }],
        ...(recordUpdate === undefined ? {} : { recordUpdate }),
      }),
    });
  }

  it("não cria um lançamento duplicado quando o RDO completo será salvo em seguida", async () => {
    const response = await POST(request(false));

    expect(response.status).toBe(200);
    expect(mocks.updateChecklistProgress).toHaveBeenCalledWith(
      "service-1",
      [{ id: "item-1", progress: 60, status: "andamento" }],
      { preserveServiceProgress: true },
    );
    expect(mocks.addComputedUpdate).not.toHaveBeenCalled();
  });

  it("mantém o lançamento calculado para chamadas independentes do checklist", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.addComputedUpdate).toHaveBeenCalledWith("service-1", 60, undefined, "TOKEN");
  });
});
