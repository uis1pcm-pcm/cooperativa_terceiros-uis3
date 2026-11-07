"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);

    try {
      const sessionResp = await fetch("/api/pcm/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password: pass }),
      });

      if (!sessionResp.ok) {
        const data = (await sessionResp.json().catch(() => null)) as { error?: string } | null;
        setErr(data?.error ?? "E-mail ou senha inválidos.");
        return;
      }

      router.replace("/dashboard");
    } catch (error: unknown) {
      console.error("[login] Falha ao iniciar sessão", error);
      setErr("Não foi possível entrar. Verifique a conexão e tente novamente.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="container mx-auto flex min-h-[calc(100dvh-56px-48px)] items-center justify-center px-4 py-10">
      <div className="card w-full max-w-lg space-y-6 p-8 shadow-xl shadow-primary/10">
        <div className="flex items-center gap-3 text-sm text-primary">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/15 text-lg">🔐</span>
          <span className="font-semibold uppercase tracking-[0.2em] text-primary/80">Acesso seguro</span>
        </div>
        <div className="space-y-2">
          <h1 className="text-3xl font-semibold tracking-tight">Login (PCM/Terceiros)</h1>
          <p className="text-sm text-muted-foreground">
            Acesse com suas credenciais. Se você recebeu um código, use <Link href="/acesso" className="link">Acesso por token</Link>.
          </p>
        </div>

        <form onSubmit={onSubmit} className="grid gap-4">
          <label className="grid gap-1">
            <span className="text-sm">E-mail</span>
            <input
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="seu@email.com"
            />
          </label>

          <label className="grid gap-1">
            <span className="text-sm">Senha</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={pass}
              onChange={(e) => setPass(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </label>

          {err && <div className="text-sm text-red-500">{err}</div>}

          <button
            type="submit"
            className="btn btn-primary h-11 px-5 shadow-md shadow-primary/20 transition-transform hover:-translate-y-[1px]"
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? "Entrando..." : "Entrar"}
          </button>

          <div className="mt-2 text-right">
            <Link href="/acesso" className="link">Acesso por token</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
