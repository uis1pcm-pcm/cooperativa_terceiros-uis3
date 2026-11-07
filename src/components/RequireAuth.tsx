"use client";
import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/lib/auth/useAuth";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, initializing } = useAuth();

  useEffect(() => {
    if (!initializing && !user) router.replace("/login");
  }, [initializing, user, router]);

  if (initializing) {
    return (
      <div className="container-page">
        <div className="card text-sm text-muted-foreground">Carregando…</div>
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
