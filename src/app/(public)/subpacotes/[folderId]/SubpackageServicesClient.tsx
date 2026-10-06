"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  resolveLastUpdateStage,
  sortPublicSubpackageServices,
  type LastUpdateStage,
  type PublicSubpackageService,
} from "@/lib/subpackageServices";

const STAGE_PRESENTATION: Record<LastUpdateStage, { label: string; className: string }> = {
  today: {
    label: "Hoje",
    className: "border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-100",
  },
  yesterday: {
    label: "Ontem",
    className: "border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-700 dark:bg-amber-900/40 dark:text-amber-100",
  },
  before: {
    label: "Antes",
    className: "border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
  },
};

function InfoItem({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function formatLastUpdate(value: number | null): string | null {
  if (value === null) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SubpackageServicesClient({
  folderId,
  token,
  initialServices,
}: {
  folderId: string;
  token: string;
  initialServices: PublicSubpackageService[];
}) {
  const [services, setServices] = useState(initialServices);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const restoredScroll = useRef(false);
  const storageKey = `subpackage-scroll:${folderId}`;
  const sortedServices = useMemo(() => sortPublicSubpackageServices(services), [services]);
  const pendingCount = sortedServices.filter(
    (service) => service.progress < 100 && service.status !== "Concluído",
  ).length;

  const refreshServices = useCallback(async () => {
    try {
      const url = new URL(`/api/public/folders/${encodeURIComponent(folderId)}/services`, window.location.origin);
      url.searchParams.set("token", token);
      const response = await fetch(url.toString(), { cache: "no-store" });
      const payload = (await response.json().catch(() => null)) as
        | { ok?: boolean; services?: PublicSubpackageService[] }
        | null;
      if (!response.ok || !payload?.ok || !Array.isArray(payload.services)) {
        setRefreshWarning(true);
        return;
      }
      setServices(payload.services);
      setRefreshWarning(false);
    } catch {
      setRefreshWarning(true);
    }
  }, [folderId, token]);

  useEffect(() => {
    void refreshServices();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshServices();
    };
    const refreshWhenReturning = () => void refreshServices();
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("pageshow", refreshWhenReturning);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("pageshow", refreshWhenReturning);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refreshServices]);

  useEffect(() => {
    if (restoredScroll.current) return;
    restoredScroll.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null") as
        | { serviceId?: string; scrollY?: number }
        | null;
      if (!saved) return;
      window.requestAnimationFrame(() => {
        const card = saved.serviceId ? document.getElementById(`service-${saved.serviceId}`) : null;
        if (card) {
          card.scrollIntoView({ block: "center" });
        } else if (typeof saved.scrollY === "number") {
          window.scrollTo({ top: saved.scrollY });
        }
      });
    } catch {
      // sessionStorage pode estar indisponível em navegadores com armazenamento bloqueado.
    }
  }, [storageKey]);

  const rememberPosition = (serviceId: string) => {
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ serviceId, scrollY: window.scrollY }));
    } catch {
      // A navegação continua normalmente mesmo sem persistência da posição.
    }
  };

  if (sortedServices.length === 0) {
    return <div className="mt-6 card p-6 text-sm text-muted-foreground">Nenhum serviço elegível foi encontrado para este subpacote.</div>;
  }

  return (
    <div className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card/60 px-4 py-3 text-xs text-muted-foreground">
        <span>{pendingCount} pendente{pendingCount === 1 ? "" : "s"} no topo · concluídos ao final</span>
        <span className={refreshWarning ? "font-medium text-amber-700" : "text-emerald-700"}>
          {refreshWarning ? "Não foi possível atualizar os dados" : "● Dados atualizados ao abrir ou retornar"}
        </span>
      </div>

      {sortedServices.map((service) => {
        const completed = service.progress >= 100 || service.status === "Concluído";
        const stage = resolveLastUpdateStage(service.lastUpdateAt);
        const stagePresentation = STAGE_PRESENTATION[stage];
        const updatedAtLabel = formatLastUpdate(service.lastUpdateAt);
        return (
          <article id={`service-${service.id}`} key={service.id} className="card scroll-mt-24 border shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4">
              <div className="min-w-0 space-y-1">
                <h2 className="text-lg font-semibold text-foreground">{service.title}</h2>
                {service.subtitle ? <p className="text-sm text-muted-foreground">{service.subtitle}</p> : null}
              </div>
              <div className="flex flex-col items-end gap-2 text-sm font-semibold">
                <div className="flex flex-wrap justify-end gap-2">
                  <span className={`rounded-full px-3 py-1 ${completed ? "border border-emerald-200 bg-emerald-100 text-emerald-800 dark:border-emerald-700/70 dark:bg-emerald-900/40 dark:text-emerald-50" : "border border-primary/40 bg-primary/10 text-primary"}`}>
                    {service.status}
                  </span>
                  <span
                    title={updatedAtLabel ? `Última atualização: ${updatedAtLabel}` : "Nenhuma atualização registrada"}
                    className={`rounded-full border px-3 py-1 ${stagePresentation.className}`}
                  >
                    Última atualização: {stagePresentation.label}
                  </span>
                </div>
                <span className="text-muted-foreground">{service.progress}% concluído</span>
              </div>
            </div>

            <div className="px-6 py-4">
              <dl className="grid gap-4">
                <InfoItem label="Tag" value={service.tag || "—"} />
                <InfoItem label="Descrição" value={service.description || "—"} />
              </dl>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-3 border-t bg-muted/40 px-6 py-4 text-sm">
              <Link
                href={`/s/${service.id}?token=${encodeURIComponent(token)}`}
                className="btn btn-primary"
                onClick={() => rememberPosition(service.id)}
              >
                PREENCHER RDO
              </Link>
            </div>
          </article>
        );
      })}
    </div>
  );
}
