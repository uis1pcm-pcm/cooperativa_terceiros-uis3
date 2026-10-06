"use client";
import { onAuthStateChanged, type User } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { tryGetAuth } from "@/lib/firebase";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { auth: authInstance, error: authError } = useMemo(() => tryGetAuth(), []);
  const [user, setUser] = useState<User | null | undefined>(undefined);

  useEffect(() => {
    if (authError) {
      console.error("[require-auth] Autenticação indisponível", authError);
    }
  }, [authError]);

  useEffect(() => {
    if (!authInstance) return;
    const unsub = onAuthStateChanged(authInstance, (u) => setUser(u ?? null));
    return () => unsub();
  }, [authInstance]);

  useEffect(() => {
    if (user === null) router.replace("/login");
  }, [user, router]);

  if (!authInstance) {
    return (
      <div className="container-page">
        <div className="card text-sm text-amber-600">
          Não foi possível carregar a autenticação. Entre em contato com o suporte.
        </div>
      </div>
    );
  }

  if (user === undefined) {
    return (
      <div className="container-page">
        <div className="card text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  return <>{children}</>;
}
