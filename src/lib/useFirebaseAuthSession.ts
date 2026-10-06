import { useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, type Auth, type User } from "firebase/auth";

import { tryGetAuth } from "@/lib/firebase";

export type FirebaseAuthSession = {
  auth: Auth | null;
  user: User | null;
  ready: boolean;
  syncing: boolean;
  issue: string | null;
  error: Error | null;
};

export function useFirebaseAuthSession(): FirebaseAuthSession {
  const { auth, error } = useMemo(() => tryGetAuth(), []);
  const [state, setState] = useState<FirebaseAuthSession>(() => {
    if (error) {
      return {
        auth: null,
        user: null,
        ready: false,
        syncing: false,
        issue: "Autenticação indisponível. Atualize a página ou contate o suporte.",
        error,
      };
    }
    if (!auth) {
      return {
        auth: null,
        user: null,
        ready: false,
        syncing: false,
        issue: "Não foi possível inicializar a autenticação segura.",
        error: null,
      };
    }
    if (auth.currentUser) {
      return {
        auth,
        user: auth.currentUser,
        ready: true,
        syncing: false,
        issue: null,
        error: null,
      };
    }
    return {
      auth,
      user: null,
      ready: false,
      syncing: true,
      issue: "Sincronizando sessão segura. Aguarde...",
      error: null,
    };
  });

  useEffect(() => {
    if (error) {
      setState({
        auth: null,
        user: null,
        ready: false,
        syncing: false,
        issue: "Autenticação indisponível. Atualize a página ou contate o suporte.",
        error,
      });
      return;
    }

    if (!auth) {
      setState({
        auth: null,
        user: null,
        ready: false,
        syncing: false,
        issue: "Não foi possível inicializar a autenticação segura.",
        error: null,
      });
      return;
    }

    if (auth.currentUser) {
      setState({
        auth,
        user: auth.currentUser,
        ready: true,
        syncing: false,
        issue: null,
        error: null,
      });
      return;
    }

    setState({
      auth,
      user: null,
      ready: false,
      syncing: true,
      issue: "Sincronizando sessão segura. Aguarde...",
      error: null,
    });

    let mounted = true;
    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        if (!mounted) return;
        if (nextUser) {
          setState({
            auth,
            user: nextUser,
            ready: true,
            syncing: false,
            issue: null,
            error: null,
          });
        } else {
          setState({
            auth,
            user: null,
            ready: false,
            syncing: false,
            issue: "Sua sessão expirou. Faça login novamente.",
            error: null,
          });
        }
      },
      (listenerError) => {
        if (!mounted) return;
        const mappedError =
          listenerError instanceof Error ? listenerError : new Error(String(listenerError));
        setState({
          auth,
          user: null,
          ready: false,
          syncing: false,
          issue: "Não foi possível validar sua sessão segura.",
          error: mappedError,
        });
      },
    );

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [auth, error]);

  return state;
}
