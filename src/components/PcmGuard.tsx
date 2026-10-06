"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";

import { tryGetAuth } from "@/lib/firebase";

type PcmGuardProps = {
  allowlist?: string;
  children: ReactNode;
};

type GuardState = "loading" | "unauthenticated" | "unauthorized" | "authorized";

function parseAllowlist(rawValue: string | undefined): string[] {
  if (!rawValue) return [];
  return rawValue
    .split(";")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

export default function PcmGuard({ children, allowlist }: PcmGuardProps) {
  const normalizedAllowlist = useMemo(() => parseAllowlist(allowlist), [allowlist]);
  const [state, setState] = useState<GuardState>("loading");
  const { auth: authInstance, error: authError } = useMemo(() => tryGetAuth(), []);

  useEffect(() => {
    if (authError) {
      console.error("[pcm-guard] Falha ao inicializar autenticação do Firebase", authError);
      setState("unauthenticated");
    }
  }, [authError]);

  useEffect(() => {
    if (!authInstance) return;

    const unsubscribe = onAuthStateChanged(authInstance, (user) => {
      if (!user) {
        setState("unauthenticated");
        return;
      }

      const email = user.email?.trim().toLowerCase();
      if (!email || !normalizedAllowlist.includes(email)) {
        setState("unauthorized");
        return;
      }

      setState("authorized");
    });

    return () => {
      unsubscribe();
    };
  }, [authInstance, normalizedAllowlist]);

  if (!authInstance) {
    return (
      <div className="p-6 text-sm text-amber-600">
        A autenticação não pôde ser carregada. Entre em contato com o suporte.
      </div>
    );
  }

  if (state === "loading") {
    return <div className="p-6 text-sm text-gray-500">Carregando…</div>;
  }

  if (state === "unauthenticated") {
    return (
      <div className="p-6 text-sm text-gray-700">
        Acesso restrito. <Link href="/login" className="underline">Faça login</Link> para continuar.
      </div>
    );
  }

  if (state === "unauthorized") {
    return <div className="p-6 text-sm text-gray-700">Acesso restrito ao PCM.</div>;
  }

  return <>{children}</>;
}
