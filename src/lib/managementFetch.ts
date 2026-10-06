"use client";

import { tryGetAuth } from "@/lib/firebase";

export async function managementFetch(input: string, init?: RequestInit): Promise<Response> {
  const { auth, error } = tryGetAuth();
  const user = auth?.currentUser;
  if (!user) {
    throw error ?? new Error("Faça login novamente para continuar.");
  }

  const idToken = await user.getIdToken();
  const headers = new Headers(init?.headers ?? undefined);
  if (init?.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  headers.set("Authorization", `Bearer ${idToken}`);

  return fetch(input, { ...init, headers });
}
