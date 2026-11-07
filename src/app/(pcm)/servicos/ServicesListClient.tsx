"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import {
  resolveServicoPercentualPlanejado,
  resolveServicoRealPercent,
} from "@/lib/serviceProgress";
import { formatDate, formatDateTime } from "@/lib/formatDateTime";
import { resolveReferenceDate } from "@/lib/referenceDate";
import type { PCMListResponse, PCMServiceListItem } from "@/types/pcm";

const STATUS_LABEL: Record<string, string> = {
  concluido: "Concluído",
  "concluído": "Concluído",
  encerrado: "Concluído",
  pendente: "Pendente",
  aberto: "Aberto",
};

const STATUS_TONE: Record<string, string> = {
  Concluído:
    "border-emerald-200 bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200/80 dark:border-emerald-700/80 dark:bg-emerald-900/40 dark:text-emerald-100 dark:ring-emerald-700/70",
  Pendente: "bg-amber-100 text-amber-700 border-amber-200",
  Aberto: "bg-sky-100 text-sky-700 border-sky-200",
};

function normaliseStatus(status: PCMServiceListItem["status"]): string {
  const raw = String(status ?? "").trim().toLowerCase();
  return STATUS_LABEL[raw] ?? "Aberto";
}

function deriveStatusLabel(status: PCMServiceListItem["status"], realizedPercent: number) {
  const normalised = normaliseStatus(status);
  if (normalised === "Pendente") return normalised;
  if (realizedPercent >= 100) return "Concluído";
  return normalised;
}

function resolveIdentifier(service: PCMServiceListItem) {
  return service.os || service.code || service.tag || service.id;
}

function resolveOc(service: PCMServiceListItem) {
  const oc = typeof service.oc === "string" ? service.oc.trim() : "";
  return oc || null;
}

function resolveSubtitle(service: PCMServiceListItem) {
  return service.equipmentName || service.equipamento || service.setor || service.sector || "";
}

function resolvePlannedDate(service: PCMServiceListItem, ...fields: string[]) {
  for (const field of fields) {
    const value = service[field];
    if (typeof value === "string" || typeof value === "number" || value instanceof Date) {
      return formatDate(value, { timeZone: "America/Sao_Paulo", fallback: "—" });
    }
  }
  return "—";
}

function resolveCompanyLabel(service: PCMServiceListItem) {
  return (
    service.assignedTo?.companyName ||
    service.assignedTo?.companyId ||
    service.company ||
    service.empresa ||
    undefined
  );
}

function resolvePercentualRealAtual(service: PCMServiceListItem, referenceDate: Date) {
  const resolved = resolveServicoRealPercent(service, referenceDate);
  const normalisedStatus = normaliseStatus(service.status);

  if (Number.isFinite(resolved) && resolved > 0) {
    return Math.round(resolved);
  }

  const storedCandidates = [
    service.andamento,
    service.realPercent,
    service.realPercentSnapshot,
    service.manualPercent,
    service.percentualReal,
    service.percentualRealAtual,
    service.percentualInformado,
    service.progressoReal,
    service.realProgress,
    service.currentProgress,
    service.progress,
    service.percent,
    service.pct,
  ];

  const bestStored = storedCandidates.reduce<number | null>((best, value) => {
    if (typeof value === "number" && Number.isFinite(value)) {
      const rounded = Math.round(value);
      return best === null ? rounded : Math.max(best, rounded);
    }
    return best;
  }, null);

  if (bestStored !== null) {
    return Math.min(100, Math.max(0, bestStored));
  }

  if (normalisedStatus === "Concluído") {
    return 100;
  }

  return 0;
}

type Props = {
  initialItems: PCMServiceListItem[];
  initialCursor: string | null;
};

export default function ServicesListClient({ initialItems, initialCursor }: Props) {
  const [items, setItems] = useState(initialItems);
  const [cursor, setCursor] = useState(initialCursor);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [osFilter, setOsFilter] = useState("");
  const [searchItems, setSearchItems] = useState<PCMServiceListItem[] | null>(null);
  const [dateRangeItems, setDateRangeItems] = useState<PCMServiceListItem[] | null>(null);
  const [dateRangeCursor, setDateRangeCursor] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [isFilteringDates, setIsFilteringDates] = useState(false);
  const searchParams = useSearchParams();
  const refDateParam = searchParams?.get("refDate") ?? null;
  const { date: referenceDate } = useMemo(() => resolveReferenceDate(refDateParam), [refDateParam]);
  const filteredItems = dateRangeItems ?? searchItems ?? items;

  useEffect(() => {
    const query = osFilter.trim();
    if (dateFrom && dateTo) {
      setSearchItems(null);
      setIsSearching(false);
      return;
    }
    if (!query) {
      setSearchItems(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsSearching(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams({ limit: "50", q: query });
        const response = await fetch(`/api/pcm/servicos?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Falha ao buscar serviços: ${response.status}`);
        }
        const payload = (await response.json()) as PCMListResponse<PCMServiceListItem>;
        setSearchItems(payload.items);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[ServicesListClient] Falha ao buscar serviços", error);
        setErrorMessage("Não foi possível buscar serviços. Tente novamente.");
        setSearchItems([]);
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 400);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [dateFrom, dateTo, osFilter]);

  useEffect(() => {
    if (!dateFrom || !dateTo) {
      setDateRangeItems(null);
      setDateRangeCursor(null);
      setIsFilteringDates(false);
      setErrorMessage(null);
      return;
    }

    setDateRangeItems([]);
    setDateRangeCursor(null);
    if (dateFrom > dateTo) {
      setIsFilteringDates(false);
      setErrorMessage("A data inicial deve ser anterior ou igual à data final.");
      return;
    }

    setIsFilteringDates(true);
    setErrorMessage(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setIsFilteringDates(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams({
          limit: "50",
          dateFrom,
          dateTo,
        });
        const query = osFilter.trim();
        if (query) params.set("q", query);
        const response = await fetch(`/api/pcm/servicos?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(`Falha ao filtrar serviços por data: ${response.status}`);
        }
        const payload = (await response.json()) as PCMListResponse<PCMServiceListItem>;
        setDateRangeItems(payload.items);
        setDateRangeCursor(payload.nextCursor ?? null);
      } catch (error) {
        if (controller.signal.aborted) return;
        console.error("[ServicesListClient] Falha ao filtrar serviços por data", error);
        setErrorMessage("Não foi possível filtrar por data. Tente novamente.");
        setDateRangeItems([]);
      } finally {
        if (!controller.signal.aborted) setIsFilteringDates(false);
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [dateFrom, dateTo, osFilter]);

  const handleLoadMore = useCallback(async () => {
    if (dateRangeItems !== null && dateFrom && dateTo && dateRangeCursor) {
      setIsLoadingMore(true);
      setErrorMessage(null);
      try {
        const params = new URLSearchParams({
          limit: "50",
          dateFrom,
          dateTo,
          cursor: dateRangeCursor,
        });
        const query = osFilter.trim();
        if (query) params.set("q", query);
        const response = await fetch(`/api/pcm/servicos?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        if (!response.ok) {
          throw new Error(`Falha ao carregar mais serviços: ${response.status}`);
        }
        const payload = (await response.json()) as PCMListResponse<PCMServiceListItem>;
        setDateRangeItems((previous) => [...(previous ?? []), ...payload.items]);
        setDateRangeCursor(payload.nextCursor ?? null);
      } catch (error) {
        console.error("[ServicesListClient] Falha ao carregar serviços filtrados", error);
        setErrorMessage("Não foi possível carregar mais serviços. Tente novamente.");
      } finally {
        setIsLoadingMore(false);
      }
      return;
    }

    if (!cursor) return;
    setIsLoadingMore(true);
    setErrorMessage(null);
    try {
      const params = new URLSearchParams({ limit: "15", cursor });
      const response = await fetch(`/api/pcm/servicos?${params.toString()}`, {
        method: "GET",
        cache: "no-store",
      });
      if (!response.ok) {
        throw new Error(`Falha ao carregar mais serviços: ${response.status}`);
      }
      const payload = (await response.json()) as PCMListResponse<PCMServiceListItem>;
      setItems((prev) => [...prev, ...payload.items]);
      setCursor(payload.nextCursor ?? null);
    } catch (error) {
      console.error("[ServicesListClient] Falha ao carregar mais serviços", error);
      setErrorMessage("Não foi possível carregar mais serviços. Tente novamente.");
    } finally {
      setIsLoadingMore(false);
    }
  }, [cursor, dateFrom, dateRangeCursor, dateRangeItems, dateTo, osFilter]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4">
        <div className="w-full space-y-1 text-sm sm:w-auto sm:min-w-[240px] sm:max-w-xs">
          <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="os-filter">
            Filtrar por O.S
          </label>
          <input
            id="os-filter"
            type="text"
            value={osFilter}
            onChange={(event) => setOsFilter(event.target.value)}
            placeholder="Digite O.S, O.C, tag, equipamento ou empresa"
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
          />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 text-sm">
            <label
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              htmlFor="service-date-from"
            >
              Início do período
            </label>
            <input
              id="service-date-from"
              type="date"
              value={dateFrom}
              onChange={(event) => setDateFrom(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          <div className="space-y-1 text-sm">
            <label
              className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              htmlFor="service-date-to"
            >
              Fim do período
            </label>
            <input
              id="service-date-to"
              type="date"
              value={dateTo}
              onChange={(event) => setDateTo(event.target.value)}
              className="rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
            />
          </div>
          {dateFrom || dateTo ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                setDateFrom("");
                setDateTo("");
              }}
            >
              Limpar datas
            </button>
          ) : null}
        </div>
      </div>

      {isFilteringDates ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          Filtrando serviços pelo período...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 text-sm text-muted-foreground">
          {dateRangeItems !== null
            ? "Nenhum serviço encontrado no período informado."
            : "Nenhum serviço encontrado para a busca informada."}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredItems.map((service) => {
            const serviceHref = `/servicos/${encodeURIComponent(service.id)}`;
          const plannedPercent = Math.round(resolveServicoPercentualPlanejado(service, referenceDate));
          const realPercent = resolvePercentualRealAtual(service, referenceDate);
            const statusLabel = deriveStatusLabel(service.status, realPercent);
            const statusTone = STATUS_TONE[statusLabel] ?? "border-border bg-muted text-foreground/80";
          const isComplete = realPercent >= 100;
          const identifier = resolveIdentifier(service);
          const oc = resolveOc(service);
          const subtitle = resolveSubtitle(service);
          const companyLabel = resolveCompanyLabel(service);
          const plannedStart = resolvePlannedDate(
            service,
            "plannedStart",
            "inicioPrevisto",
            "dataInicio",
            "inicioPlanejado",
            "startDate",
          );
          const plannedEnd = resolvePlannedDate(
            service,
            "plannedEnd",
            "fimPrevisto",
            "dataFim",
            "fimPlanejado",
            "endDate",
          );
          const lastUpdate = service.updatedAt ?? service.createdAt ?? null;
          const lastUpdateLabel =
            typeof lastUpdate === "number"
              ? formatDateTime(lastUpdate, { timeZone: "America/Sao_Paulo", fallback: "" })
              : "";

            return (
              <Link
                key={service.id}
                className="group flex flex-col gap-4 rounded-2xl border bg-card/80 p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/60 hover:shadow-md focus-visible:outline-none focus-visible:ring"
                href={serviceHref}
              >
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}>
                        {statusLabel}
                      </span>
                      <span
                        className={`rounded-full border border-transparent px-2 py-0.5 text-xs ${
                          isComplete ? "bg-emerald-100 text-emerald-700" : "bg-muted/60 text-muted-foreground"
                        }`}
                      >
                        {realPercent}% concluído
                      </span>
                    </div>
                    {lastUpdateLabel ? (
                      <span className="whitespace-nowrap text-[11px] font-medium text-muted-foreground">
                        Atualizado em {lastUpdateLabel}
                      </span>
                    ) : null}
                  </div>
                  <div className="space-y-1">
                    <p className="line-clamp-2 text-base font-semibold text-foreground">{identifier}</p>
                    {oc ? <p className="text-xs text-muted-foreground">O.C: {oc}</p> : null}
                    {subtitle ? <p className="text-sm text-muted-foreground">{subtitle}</p> : null}
                    <p className="text-xs text-muted-foreground">
                      Planejado: <span className="font-semibold text-foreground">{plannedPercent}%</span> | Real:{" "}
                      <span className="font-semibold text-foreground">{realPercent}%</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Início: <span className="font-medium text-foreground">{plannedStart}</span>
                      {" · "}
                      Fim: <span className="font-medium text-foreground">{plannedEnd}</span>
                    </p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${
                        isComplete ? "bg-emerald-500" : "bg-primary"
                      }`}
                      style={{ width: `${realPercent}%` }}
                    />
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>{companyLabel ? `Empresa: ${companyLabel}` : `Pacote: ${service.packageId ?? "Não vinculado"}`}</span>
                    <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground/80 transition group-hover:bg-primary/10 group-hover:text-primary">
                      Ver serviço
                    </span>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
      <div className="flex flex-col gap-3 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p>
            Mostrando {filteredItems.length} serviço{filteredItems.length === 1 ? "" : "s"}
            {osFilter.trim() ? ` encontrado${filteredItems.length === 1 ? "" : "s"} na busca` : ""}.
          </p>
          {isSearching ? <p>Buscando em todos os serviços...</p> : null}
          {errorMessage ? <p className="text-destructive">{errorMessage}</p> : null}
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={
            isLoadingMore ||
            (dateRangeItems !== null
              ? !dateRangeCursor || isFilteringDates
              : Boolean(osFilter.trim()) || !cursor)
          }
          onClick={handleLoadMore}
        >
          {isLoadingMore
            ? "Carregando..."
            : dateRangeItems !== null
              ? dateRangeCursor
                ? "Carregar mais"
                : "Todos carregados"
              : cursor
                ? "Carregar mais"
                : "Todos carregados"}
        </button>
      </div>
    </div>
  );
}
