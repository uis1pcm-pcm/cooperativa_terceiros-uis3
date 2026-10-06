"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  setLogLevel,
  type Firestore,
} from "firebase/firestore";

import { getFirebasePublicConfig } from "@/lib/firebaseConfig";

type FirebaseClientGlobal = typeof globalThis & {
  __FIREBASE_CLIENT_APP__?: FirebaseApp;
  __FIREBASE_CLIENT_AUTH__?: Auth;
  __FIREBASE_CLIENT_DB__?: Firestore;
  __FIREBASE_CLIENT_ERROR__?: Error;
  __FIREBASE_CLIENT_FORCE_LONG_POLLING__?: boolean;
  __FIREBASE_CLIENT_USE_FETCH_STREAMS__?: boolean;
  __FIREBASE_CLIENT_LOGGED__?: boolean;
};

const globalForFirebase = globalThis as FirebaseClientGlobal;

function parseBooleanEnv(value: string | undefined | null): boolean | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return null;
}

const envForceLongPolling = parseBooleanEnv(process.env.NEXT_PUBLIC_FIRESTORE_FORCE_LONG_POLLING);
const envUseFetchStreams = parseBooleanEnv(process.env.NEXT_PUBLIC_FIRESTORE_USE_FETCH_STREAMS);

const shouldForceLongPolling = (() => {
  if (envForceLongPolling !== null) {
    return envForceLongPolling;
  }
  if (envUseFetchStreams === true) {
    return false;
  }
  return true;
})();

const shouldEnableFetchStreams = (() => {
  if (shouldForceLongPolling) {
    return false;
  }
  if (envUseFetchStreams === true) {
    return true;
  }
  return false;
})();

const shouldAutoDetectLongPolling = !shouldForceLongPolling && !shouldEnableFetchStreams;

function logNetworkStrategy() {
  if (globalForFirebase.__FIREBASE_CLIENT_LOGGED__ || process.env.NODE_ENV === "production") {
    return;
  }
  const strategy = shouldForceLongPolling
    ? "long-polling forçado"
    : shouldEnableFetchStreams
      ? "fetch streams habilitado"
      : "detecção automática";
  const envSummary = `NEXT_PUBLIC_FIRESTORE_FORCE_LONG_POLLING=${
    envForceLongPolling ?? "auto"
  } | NEXT_PUBLIC_FIRESTORE_USE_FETCH_STREAMS=${envUseFetchStreams ?? "auto"}`;
  console.info(`[firebase] Firestore usando estratégia de rede: ${strategy} (${envSummary}).`);
  globalForFirebase.__FIREBASE_CLIENT_LOGGED__ = true;
}

if (!globalForFirebase.__FIREBASE_CLIENT_APP__ && !globalForFirebase.__FIREBASE_CLIENT_ERROR__) {
  try {
    const config = getFirebasePublicConfig();
    const app = getApps().length ? getApp() : initializeApp(config);

    const firestoreSettings: Parameters<typeof initializeFirestore>[1] = {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    };
    if (shouldForceLongPolling) {
      firestoreSettings.experimentalForceLongPolling = true;
    } else if (shouldEnableFetchStreams) {
      (
        firestoreSettings as Parameters<typeof initializeFirestore>[1] & { useFetchStreams?: boolean }
      ).useFetchStreams = true;
    } else if (shouldAutoDetectLongPolling) {
      firestoreSettings.experimentalAutoDetectLongPolling = true;
    }

    logNetworkStrategy();

    if (process.env.NODE_ENV !== "production") {
      setLogLevel("error");
    }

    const db = initializeFirestore(app, firestoreSettings);
    const auth = getAuth(app);

    globalForFirebase.__FIREBASE_CLIENT_APP__ = app;
    globalForFirebase.__FIREBASE_CLIENT_DB__ = db;
    globalForFirebase.__FIREBASE_CLIENT_AUTH__ = auth;
    globalForFirebase.__FIREBASE_CLIENT_FORCE_LONG_POLLING__ = shouldForceLongPolling;
    globalForFirebase.__FIREBASE_CLIENT_USE_FETCH_STREAMS__ = shouldEnableFetchStreams;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    globalForFirebase.__FIREBASE_CLIENT_ERROR__ = err;
    if (process.env.NODE_ENV !== "production") {
      console.error("[firebase] Falha ao inicializar Firebase client", err);
    }
  }
}

const initializationError = globalForFirebase.__FIREBASE_CLIENT_ERROR__ ?? null;
const resolvedApp = globalForFirebase.__FIREBASE_CLIENT_APP__ ?? null;
const resolvedDb = globalForFirebase.__FIREBASE_CLIENT_DB__ ?? null;
const resolvedAuth = globalForFirebase.__FIREBASE_CLIENT_AUTH__ ?? null;

logNetworkStrategy();

export const db = resolvedDb;
export const auth = resolvedAuth;
export default resolvedApp;

export const isFirestoreLongPollingForced =
  globalForFirebase.__FIREBASE_CLIENT_FORCE_LONG_POLLING__ ?? shouldForceLongPolling;
export const isFirestoreFetchStreamsEnabled =
  globalForFirebase.__FIREBASE_CLIENT_USE_FETCH_STREAMS__ ?? shouldEnableFetchStreams;

export function tryGetClientApp(): { app: FirebaseApp | null; error: Error | null } {
  return { app: resolvedApp, error: initializationError };
}

export function getClientApp(): FirebaseApp {
  if (initializationError) {
    throw initializationError;
  }
  if (!resolvedApp) {
    throw new Error("Firebase client não pôde ser inicializado.");
  }
  return resolvedApp;
}

export const getClientFirebaseApp = getClientApp;

export function tryGetAuth(): { auth: Auth | null; error: Error | null } {
  if (initializationError) {
    return { auth: null, error: initializationError };
  }
  return { auth: resolvedAuth, error: null };
}

export function getAuthClient(): Auth {
  if (initializationError) {
    throw initializationError;
  }
  if (!resolvedAuth) {
    throw new Error("Firebase auth não pôde ser inicializado.");
  }
  return resolvedAuth;
}

export function tryGetFirestore(): { db: Firestore | null; error: Error | null } {
  if (initializationError) {
    return { db: null, error: initializationError };
  }
  return { db: resolvedDb, error: null };
}

export function getFirestoreClient(): Firestore {
  if (initializationError) {
    throw initializationError;
  }
  if (!resolvedDb) {
    throw new Error("Firestore client não pôde ser inicializado.");
  }
  return resolvedDb;
}
