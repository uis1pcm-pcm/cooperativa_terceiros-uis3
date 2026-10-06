"use client";
import Link from "next/link";
import { useAuth } from "@/lib/auth/useAuth";
import { signOut } from "firebase/auth";

import { tryGetAuth } from "@/lib/firebase";
import ThemeToggle from "@/components/ThemeToggle";

export default function HeaderClient() {
  const { user } = useAuth();

  async function doLogout() {
    try {
      await fetch("/api/pcm/session", { method: "DELETE" });
    } catch (error) {
      console.error("[header] Falha ao encerrar sessão PCM", error);
    }

    const { auth, error } = tryGetAuth();
    if (!auth) {
      console.error("[header] Autenticação indisponível", error);
      return;
    }
    await signOut(auth);
    window.location.href = "/login";
  }

  return (
    <nav className="flex min-w-0 flex-wrap items-center justify-end gap-2 text-sm text-muted-foreground sm:gap-3">
      {user ? (
        <>
          <Link className="link-btn whitespace-nowrap" href="/dashboard">
            Dashboard
          </Link>
          <button
            type="button"
            onClick={doLogout}
            className="btn btn-ghost whitespace-nowrap"
          >
            Sair
          </button>
        </>
      ) : (
        <Link className="link-btn whitespace-nowrap" href="/login">
          Login
        </Link>
      )}
      <ThemeToggle className="shrink-0" />
    </nav>
  );
}
