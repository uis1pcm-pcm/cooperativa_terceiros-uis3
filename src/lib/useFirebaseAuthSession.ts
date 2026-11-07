import { useEffect, useState } from "react";

export type PcmSessionUser = {
  uid: string;
  email: string;
  isAnonymous: false;
};

export type FirebaseAuthSession = {
  auth: null;
  user: PcmSessionUser | null;
  ready: boolean;
  syncing: boolean;
  issue: string | null;
  error: Error | null;
};

const initialState: FirebaseAuthSession = {
  auth: null,
  user: null,
  ready: false,
  syncing: true,
  issue: "Verificando sessão PCM...",
  error: null,
};

export function useFirebaseAuthSession(): FirebaseAuthSession {
  const [state, setState] = useState(initialState);

  useEffect(() => {
    let active = true;

    async function checkSession() {
      try {
        const response = await fetch("/api/pcm/session", { cache: "no-store" });
        const session = response.ok
          ? ((await response.json()) as { authenticated?: boolean; email?: string })
          : null;

        if (!active) return;
        if (session?.authenticated && session.email) {
          setState({
            auth: null,
            user: { uid: "pcm-fixed-login", email: session.email, isAnonymous: false },
            ready: true,
            syncing: false,
            issue: null,
            error: null,
          });
        } else {
          setState({
            auth: null,
            user: null,
            ready: false,
            syncing: false,
            issue: "Sua sessão expirou. Faça login novamente.",
            error: null,
          });
        }
      } catch (error) {
        if (!active) return;
        const sessionError = error instanceof Error ? error : new Error(String(error));
        console.error("[pcm-session] Falha ao verificar a sessão", sessionError);
        setState({
          auth: null,
          user: null,
          ready: false,
          syncing: false,
          issue: "Não foi possível validar sua sessão PCM.",
          error: sessionError,
        });
      }
    }

    void checkSession();
    return () => {
      active = false;
    };
  }, []);

  return state;
}
