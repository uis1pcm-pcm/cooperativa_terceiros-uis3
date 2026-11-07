"use client";

import { managementFetch } from "@/lib/managementFetch";

export async function createAccessToken(payload: {
  serviceId?: string;
  packageId?: string;
  pacoteId?: string;
  folderId?: string;
  pastaId?: string;
  empresa?: string;
  company?: string;
}) {
  const serviceId = payload.serviceId?.trim();
  const folderId = (payload.folderId ?? payload.pastaId)?.trim();
  const response = await managementFetch("/api/management/tokens/create", {
    method: "POST",
    body: JSON.stringify({
      targetType: serviceId ? "service" : "folder",
      targetId: serviceId || folderId,
      company: payload.empresa ?? payload.company,
      packageId: payload.packageId ?? payload.pacoteId,
      folderId,
    }),
  });
  const result = (await response.json().catch(() => null)) as
    | { token?: string; error?: string }
    | null;
  if (!response.ok || !result?.token) {
    throw new Error(result?.error ?? "Não foi possível gerar o token.");
  }
  return result.token;
}
