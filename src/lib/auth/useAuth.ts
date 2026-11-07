"use client";
import { useEffect, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";

import { tryGetAuth } from "@/lib/firebase";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const { auth, error } = tryGetAuth();
    if (!auth) {
      if (error) {
        console.error("[useAuth] Autenticação de dados indisponível", error);
      }
      setInitializing(false);
      setUser(null);
      return () => {};
    }

    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (!firebaseUser) {
        if (active) {
          setUser(null);
          setInitializing(false);
        }
        return;
      }

      try {
        const response = await fetch("/api/pcm/session", { cache: "no-store" });
        if (active) {
          const session = response.ok
            ? ((await response.json()) as { authenticated?: boolean })
            : null;
          setUser(session?.authenticated ? firebaseUser : null);
          setInitializing(false);
        }
      } catch (sessionError) {
        console.error("[useAuth] Falha ao verificar sessão PCM", sessionError);
        if (active) {
          setUser(null);
          setInitializing(false);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return { user, initializing };
}
