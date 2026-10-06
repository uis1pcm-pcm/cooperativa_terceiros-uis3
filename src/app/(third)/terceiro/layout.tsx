"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import ThemeToggle from "@/components/ThemeToggle";

export default function TerceiroLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/* Header fix: keep the toolbar globally fixed and above all content */}
      <header className="fixed top-0 left-0 right-0 z-[1000] w-full border-b border-border/70 bg-white/80 shadow-sm backdrop-blur-md supports-[backdrop-filter]:bg-white/70 dark:border-slate-800/80 dark:bg-[#0b1220]/80">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href="/terceiro" className="font-semibold tracking-tight">
            Portal <span className="text-primary">Terceiro</span>
          </Link>
          <nav className="flex items-center gap-2">
            <Link className="btn btn-secondary" href="/terceiro">
              Início
            </Link>
            <form
              action="/api/token-session"
              method="POST"
              onSubmit={async (e) => {
                e.preventDefault();
                await fetch("/api/token-session", { method: "DELETE" });
                location.href = "/acesso";
              }}
            >
              <button type="submit" className="btn btn-outline">
                Sair
              </button>
            </form>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <div className="min-h-[100dvh] bg-background">
        {/* Offset main content by the header height so nothing hides behind it */}
        <div className="container mx-auto px-4 pb-6 pt-14">
          <main className="mx-auto w-full max-w-[1200px]">{children}</main>
        </div>
      </div>
    </>
  );
}
