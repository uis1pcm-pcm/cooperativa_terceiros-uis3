"use client";

import { useEffect, useRef } from "react";
import { onIdTokenChanged } from "firebase/auth";

import { tryGetAuth } from "@/lib/firebase";

export default function PcmSessionSync() {
  const lastTokenRef = useRef<string | null>(null);

  useEffect(() => {
    const { auth } = tryGetAuth();
    if (!auth) {
      return () => {};
    }

    const authClient = auth;
    let abortController: AbortController | null = null;

    async function syncCurrentUser(options?: { forceRefresh?: boolean }) {
      const user = authClient.currentUser;
      if (!user) {
        lastTokenRef.current = null;
        return;
      }

      const token = await user.getIdToken(options?.forceRefresh ?? false);
      if (!token || (!options?.forceRefresh && token === lastTokenRef.current)) {
        return;
      }
      lastTokenRef.current = token;

      abortController?.abort();
      const controller = new AbortController();
      abortController = controller;

      const response = await fetch("/api/pcm/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
        signal: controller.signal,
      });

      if (!response.ok && response.status !== 403) {
        console.error("[pcm-session-sync] Falha ao atualizar cookie de sessão", {
          status: response.status,
        });
      }
    }

    const handleForceTokenRefresh = () => {
      syncCurrentUser({ forceRefresh: true }).catch((error) => {
        console.error("[pcm-session-sync] Falha ao forçar refresh do token", error);
      });
    };

    window.addEventListener("pcm:force-token-refresh", handleForceTokenRefresh);

    const unsubscribe = onIdTokenChanged(authClient, async (user) => {
      if (!user) {
        lastTokenRef.current = null;
        return;
      }

      try {
        await syncCurrentUser();
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        console.error("[pcm-session-sync] Falha ao sincronizar sessão PCM", error);
      }
    });

    return () => {
      abortController?.abort();
      window.removeEventListener("pcm:force-token-refresh", handleForceTokenRefresh);
      unsubscribe();
    };
  }, []);

  return null;
}
