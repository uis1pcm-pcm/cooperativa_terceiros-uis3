"use client";

import { useFirebaseAuthSession } from "@/lib/useFirebaseAuthSession";

export function useAuth() {
  const { user, syncing } = useFirebaseAuthSession();
  return { user, initializing: syncing };
}
