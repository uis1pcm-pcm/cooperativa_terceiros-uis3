"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";

import { createAccessToken } from "@/lib/accessTokens";

type Props = {
  service: {
    id: string;
    os: string;
    company?: string;
  };
};

type TokenResponse = {
  token: string;
  link: string;
};

export default function ServiceRowActions({ service }: Props) {
  const [isLoading, setIsLoading] = useState(false);
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const encodedId = encodeURIComponent(service.id);

  async function generateToken() {
    try {
      setIsLoading(true);
      setError(null);
      setToken(null);

      const code = await createAccessToken({ serviceId: service.id, empresa: service.company });
      const origin = typeof window !== "undefined" ? window.location.origin : "";
      const link = `${origin}/acesso?token=${code}`;
      setToken({ token: code, link });
      toast.success(`Token gerado: ${code}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Erro inesperado";
      setError(message);
      toast.error(message);
    } finally {
      setIsLoading(false);
    }
  }

  function openPdf() {
    const url = `/servicos/${encodedId}?tab=graph&export=pdf`;
    window.open(url, "_blank", "noopener");
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Link href={`/servicos/${encodedId}?tab=details`} className="btn btn-secondary text-xs">
          Editar
        </Link>
        <Link href={`/servicos/${encodedId}?tab=updates`} className="btn btn-secondary text-xs">
          Abrir serviço
        </Link>
        <button type="button" onClick={generateToken} disabled={isLoading} className="btn btn-primary text-xs">
          {isLoading ? "Gerando…" : "Gerar token"}
        </button>
        <button type="button" onClick={openPdf} className="btn btn-secondary text-xs">
          Exportar PDF
        </button>
      </div>
      {token ? (
        <div className="rounded-md border border-primary/30 bg-primary/10 p-3 text-xs">
          <div className="font-semibold text-primary">Token: {token.token}</div>
          <div className="mt-1 truncate text-muted-foreground">
            Link: {" "}
            <a className="link" href={token.link} target="_blank" rel="noreferrer">
              {token.link}
            </a>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}
    </div>
  );
}
