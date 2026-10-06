"use client";

import { useCallback, useState } from "react";
import Link from "next/link";

import type { PCMListResponse, PCMPackageListItem } from "@/types/pcm";

const STATUS_LABEL: Record<string, string> = {
  concluido: "Concluído",
  "concluído": "Concluído",
  encerrado: "Encerrado",
  aberto: "Aberto",
};

const STATUS_TONE: Record<string, string> = {
  Concluído: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Encerrado: "bg-slate-200 text-slate-700 border-slate-300",
  Aberto: "bg-sky-100 text-sky-700 border-sky-200",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
});

function normaliseStatus(status: PCMPackageListItem["status"]): string {
  const raw = String(status ?? "").trim().toLowerCase();
  return STATUS_LABEL[raw] ?? "Aberto";
}

function formatCreatedAt(timestamp?: number | null) {
  if (!timestamp || !Number.isFinite(timestamp)) return "";
  try {
    return DATE_FORMATTER.format(new Date(timestamp));
  } catch (error) {
    console.warn("[PackagesListClient] Failed to format creation date", timestamp, error);
    return "";
  }
}

function resolveServicesCount(pkg: PCMPackageListItem): number {
  if (typeof pkg.servicesCount === "number" && Number.isFinite(pkg.servicesCount)) {
    return pkg.servicesCount;
  }
  if (Array.isArray(pkg.services)) {
    return pkg.services.length;
  }
  if (Array.isArray(pkg.serviceIds)) {
    return pkg.serviceIds.length;
  }
  return 0;
}

type Props = {
  initialItems: PCMPackageListItem[];
  initialCursor: string | null;
};

export default function PackagesListClient({ initialItems, initialCursor }: Props) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const total = items.length;

  const handleLoadMore = useCallback(async () => {
    if (!cursor) return;
    setIsLoadingMore(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({ limit: "15", cursor });
      const response = await fetch(`/api/pcm/pacotes?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar mais pacotes: ${response.status}`);
      }
      const payload = (await response.json()) as PCMListResponse<PCMPackageListItem>;
      setItems((prev) => [...prev, ...payload.items]);
      setCursor(payload.nextCursor ?? null);
    } catch (error) {
      console.error("[PackagesListClient] Falha ao carregar mais pacotes", error);
      setErrorMessage("Não foi possível carregar mais pacotes. Tente novamente.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor]);

  if (total === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((pkg) => {
          const packageHref = `/pacotes/${encodeURIComponent(pkg.id)}`;
          const statusLabel = normaliseStatus(pkg.status);
          const statusTone = STATUS_TONE[statusLabel] ?? "border-border bg-muted text-foreground/80";
          const servicesCount = resolveServicesCount(pkg);
          const servicesLabel = servicesCount
            ? `${servicesCount} serviço${servicesCount === 1 ? "" : "s"}`
            : "Sem serviços";
          const createdAtLabel = formatCreatedAt(pkg.createdAt);
          return (
            <Link
              key={pkg.id}
              className="group flex flex-col justify-between gap-4 rounded-2xl border bg-card/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring"
              href={packageHref}
            >
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}>
                    {statusLabel}
                  </span>
                  {createdAtLabel ? (
                    <span className="rounded-full border border-transparent bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                      Criado em {createdAtLabel}
                    </span>
                  ) : null}
                </div>
                <p className="line-clamp-2 text-base font-semibold text-foreground">
                  {pkg.name || pkg.code || pkg.id}
                </p>
                {pkg.code ? (
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Código: {pkg.code}</p>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
                <span>{servicesLabel}</span>
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground/80 transition group-hover:bg-primary/10 group-hover:text-primary">
                  Ver detalhes
                </span>
              </div>
            </Link>
          );
        })}
      </div>
      <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p>Mostrando {total} pacote{total === 1 ? "" : "s"}.</p>
          {errorMessage ? <p className="text-destructive">{errorMessage}</p> : null}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={!cursor || isLoadingMore}
          onClick={handleLoadMore}
        >
          {isLoadingMore ? "Carregando..." : cursor ? "Carregar mais" : "Todos carregados"}
        </button>
      </div>
    </div>
  );
}
