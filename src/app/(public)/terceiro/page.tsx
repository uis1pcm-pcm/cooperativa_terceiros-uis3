"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { recordTelemetry } from "@/lib/telemetry";

type ServiceItem = {
  id: string;
  os?: string | null;
  tag?: string | null;
  equipmentName?: string | null;
  status?: string | null;
  andamento?: number | null;
  realPercent?: number | null;
  progress?: number | null;
  cnpj?: string | null;
  description?: string | null;
};

function normaliseProgress(value?: number | null) {
  if (!Number.isFinite(value ?? NaN)) return 0;
  return Math.max(0, Math.min(100, Math.round(Number(value ?? 0))));
}

function normaliseStatus(value?: string | null) {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "concluido" || raw === "concluído" || raw === "encerrado") return "Concluído";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

const POLL_INTERVAL_MS = 15_000;
const RETRY_INTERVAL_MS = 5_000;

export default function TerceiroHome() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [items, setItems] = useState<ServiceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tokenExpired, setTokenExpired] = useState(false);
  const [connectionIssue, setConnectionIssue] = useState<string | null>(null);
  const [sessionRetryKey, setSessionRetryKey] = useState(0);
  const tokenStorageKey = "third_portal_token";

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const stored = window.localStorage.getItem("companyId");
      if (stored) {
        setCompanyId((current) => current ?? stored);
      }
    } catch (storageError) {
      console.warn("[terceiro] falha ao ler companyId do localStorage", storageError);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleOnline = () => {
      setConnectionIssue(null);
      setSessionRetryKey((value) => value + 1);
    };
    const handleOffline = () => {
      setConnectionIssue("Sem conexão com a internet. Exibindo dados disponíveis.");
    };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  const companyLabel = useMemo(() => {
    if (!companyId) return null;
    return <span className="ml-2 text-xs uppercase tracking-wide">Empresa: {companyId}</span>;
  }, [companyId]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let cancelled = false;
    let controller: AbortController | null = null;
    let retryTimeout: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let firstFetch = true;
    let fetching = false;

    const scheduleRetry = (delay: number) => {
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
        retryTimeout = null;
      }
      retryTimeout = window.setTimeout(() => {
        if (cancelled) return;
        void performFetch();
      }, delay);
    };

    const clearRetry = () => {
      if (retryTimeout) {
        window.clearTimeout(retryTimeout);
        retryTimeout = null;
      }
    };

    const performFetch = async () => {
      if (fetching) return;
      fetching = true;
      controller?.abort();
      controller = new AbortController();
      if (firstFetch) {
        setLoading(true);
      }
      try {
        const response = await fetch("/api/terceiro/session", {
          cache: "no-store",
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));

        if (cancelled) return;

        if (!response.ok) {
          clearRetry();
          setItems([]);
          setCompanyId(null);

          if (response.status === 401 || payload?.error === "missing_token") {
            setError("token-expired");
            setTokenExpired(true);
            recordTelemetry("token.session.missing", {});
            try {
              window.sessionStorage.removeItem(tokenStorageKey);
            } catch (storageError) {
              console.warn("[terceiro] falha ao limpar token armazenado", storageError);
            }
            scheduleRetry(RETRY_INTERVAL_MS);
            return;
          }

          if (response.status === 404 || payload?.error === "token_not_found") {
            setError("O acesso público expirou. Solicite um novo link para continuar acompanhando os serviços.");
            setTokenExpired(true);
            recordTelemetry("token.session.expired", {});
            scheduleRetry(RETRY_INTERVAL_MS);
            return;
          }

          if (response.status >= 500) {
            const message =
              typeof payload?.error === "string" && payload.error
                ? payload.error
                : "Serviço temporariamente indisponível. Tentaremos novamente em instantes.";
            setConnectionIssue(message);
            setError(null);
            setTokenExpired(false);
            scheduleRetry(RETRY_INTERVAL_MS);
            return;
          }

          const message =
            typeof payload?.error === "string" && payload.error
              ? payload.error
              : "Não foi possível carregar os dados.";
          setError(message);
          setTokenExpired(false);
          setConnectionIssue(null);
          return;
        }

        const list = Array.isArray(payload?.services) ? (payload.services as ServiceItem[]) : [];
        const company = typeof payload?.companyId === "string" && payload.companyId ? payload.companyId : null;

        setItems(list);
        setCompanyId(company);
        setError(null);
        setTokenExpired(false);
        setConnectionIssue(null);
        clearRetry();

        if (company) {
          try {
            window.localStorage.setItem("companyId", company);
          } catch (storageError) {
            console.warn("[terceiro] não foi possível persistir companyId", storageError);
          }
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("[terceiro] falha ao carregar sessão", err);
        const isOffline = typeof navigator !== "undefined" && navigator.onLine === false;
        setConnectionIssue(
          isOffline
            ? "Sem conexão com a internet. Tentaremos sincronizar assim que possível."
            : "Não foi possível atualizar as informações. Tentaremos novamente em instantes.",
        );
        scheduleRetry(RETRY_INTERVAL_MS);
      } finally {
        if (!cancelled && firstFetch) {
          setLoading(false);
        }
        firstFetch = false;
        fetching = false;
      }
    };

    void performFetch();

    pollInterval = window.setInterval(() => {
      void performFetch();
    }, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      controller?.abort();
      clearRetry();
      if (pollInterval) {
        window.clearInterval(pollInterval);
      }
    };
  }, [sessionRetryKey, tokenStorageKey]);

  const connectionBanner = connectionIssue && !error ? (
    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">{connectionIssue}</div>
  ) : null;

  return (
    <div className="container mx-auto space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meus Serviços</h1>
          <p className="text-sm text-muted-foreground">
            Serviços abertos atribuídos à sua empresa.
            {companyLabel}
          </p>
        </div>
      </div>

      {connectionBanner}

      {loading ? (
        <div className="card p-6 text-sm text-muted-foreground">Carregando…</div>
      ) : error ? (
        <div className="card space-y-3 p-6 text-sm text-muted-foreground">
          {tokenExpired ? (
            <>
              <p>O acesso público expirou. Solicite um novo link para continuar acompanhando os serviços.</p>
              <Link className="text-primary underline" href="/acesso">
                Gerar novo acesso
              </Link>
            </>
          ) : (
            error
          )}
        </div>
      ) : items.length === 0 ? (
        <div className="card p-6 text-sm text-muted-foreground">
          {connectionIssue ? "Nenhum dado disponível no momento. Aguarde a reconexão." : "Nenhum serviço atribuído."}
        </div>
      ) : (
        <div className="card divide-y">
          {items.map((service) => {
            const progress = normaliseProgress(
              service.progress ?? service.realPercent ?? service.andamento ?? 0,
            );
            return (
              <Link
                key={service.id}
                className="flex items-center gap-3 p-4 transition hover:bg-muted/40"
                href={`/terceiro/servico/${service.id}`}
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {service.os || service.id}
                    {service.equipmentName
                      ? ` — ${service.equipmentName}`
                      : service.tag
                        ? ` — ${service.tag}`
                        : ""}
                  </p>
                  <p className="text-xs text-muted-foreground">{normaliseStatus(service.status)}</p>
                  {service.description ? (
                    <p className="truncate text-[11px] text-muted-foreground">Descrição: {service.description}</p>
                  ) : null}
                  <p className="text-[11px] text-muted-foreground">CNPJ: {service.cnpj || "—"}</p>
                </div>
                <span className="text-sm font-semibold text-primary">{progress}%</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
