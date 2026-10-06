"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { toast } from "sonner";

import { Field, RangeItem } from "@/components/ui/form-controls";
import { recordTelemetry } from "@/lib/telemetry";

type ValidateSuccess =
  | {
      ok: true;
      found: false;
      serviceIds: string[];
      targetType?: "service" | "folder";
      targetId?: string | null;
    }
  | {
      ok: true;
      found: true;
      serviceIds: string[];
      targetType: "service" | "folder";
      targetId: string;
    };

type ValidateError = { ok: false; error: string };

type ChecklistEntry = {
  id: string;
  description: string;
  weight: number;
  progress: number;
};

type ServiceSummary = {
  id: string;
  os: string;
  tag: string;
  equipamento: string;
  cnpj?: string | null;
  andamento: number;
  status: string;
  hasChecklist: boolean;
  checklist: ChecklistEntry[];
};

type PublicServiceResponse = {
  ok: true;
  service: {
    id: string;
    os: string;
    tag: string;
    equipmentName: string;
    status: string;
    realPercent?: number;
    hasChecklist?: boolean;
    cnpj?: string | null;
  };
  checklist: Array<{ id: string; description: string; weight: number; progress: number }>;
};

type PublicServiceError = { ok: false; error?: string };

function formatPercent(value: number | undefined) {
  if (!Number.isFinite(value)) return "0%";
  return `${Math.round(Number(value ?? 0))}%`;
}

function isServiceOpen(service: ServiceSummary) {
  const progress = service.andamento ?? 0;
  if (progress >= 100) return false;

  const statusRaw = typeof service.status === "string" ? service.status.trim().toLowerCase() : "";
  const statusNormalised = statusRaw || "aberto";

  if (statusNormalised === "pendente") return true;
  if (statusNormalised === "aberto" || statusNormalised === "aberta" || statusNormalised === "open") {
    return progress < 100;
  }

  const closedKeywords = ["conclu", "encerr", "fechad", "finaliz", "cancel"];
  if (closedKeywords.some((keyword) => statusNormalised.includes(keyword))) return false;

  return progress < 100;
}

const MAX_VISIBLE_SERVICES = 5;

export default function AcessoPorTokenPage() {
  const qp = useSearchParams();
  const initial = useMemo(() => (qp?.get("token") ?? "").trim().toUpperCase(), [qp]);
  const router = useRouter();
  const [token, setToken] = useState(initial);
  const [validating, setValidating] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [validatedToken, setValidatedToken] = useState<string | null>(null);
  const [services, setServices] = useState<ServiceSummary[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [selectedServiceId, setSelectedServiceId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [manualPercent, setManualPercent] = useState<string>("");
  const [checklistValues, setChecklistValues] = useState<Record<string, number>>({});
  const [savingUpdate, setSavingUpdate] = useState(false);
  const [showAllServicesList, setShowAllServicesList] = useState(false);
  const tokenStorageKey = "third_portal_token";

  const persistTokenSession = useCallback(
    async (code: string) => {
      const response = await fetch("/api/token-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: code }),
      });
      const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!response.ok || !json?.ok) {
        recordTelemetry("token.session.failure", { status: response.status, error: json?.error });
        throw new Error(json?.error ?? "Não foi possível iniciar a sessão.");
      }
      try {
        window.sessionStorage.setItem(tokenStorageKey, code);
      } catch (error) {
        console.warn("[acesso] não foi possível persistir token em sessionStorage", error);
      }
      await new Promise((resolve) => setTimeout(resolve, 60));
    },
    [tokenStorageKey],
  );

  const selectedService = useMemo(
    () => services.find((service) => service.id === selectedServiceId) ?? null,
    [services, selectedServiceId],
  );

  useEffect(() => {
    if (!selectedService) {
      setManualPercent("");
      setChecklistValues({});
      return;
    }

    const hasChecklistItems = selectedService.hasChecklist && selectedService.checklist.length > 0;

    if (hasChecklistItems) {
      const next: Record<string, number> = {};
      selectedService.checklist.forEach((item) => {
        next[item.id] = Number.isFinite(item.progress) ? Math.round(item.progress) : 0;
      });
      setChecklistValues(next);
      setManualPercent(Math.round(selectedService.andamento ?? 0).toString());
    } else {
      setManualPercent(Math.round(selectedService.andamento ?? 0).toString());
      setChecklistValues({});
    }
  }, [selectedService]);

  const fetchService = useCallback(async (tokenValue: string, serviceId: string): Promise<ServiceSummary | null> => {
    try {
      const response = await fetch(
        `/api/public/service?serviceId=${encodeURIComponent(serviceId)}&token=${encodeURIComponent(tokenValue)}`,
        { cache: "no-store" },
      );
      const json: PublicServiceResponse | PublicServiceError = await response.json();
      if (!response.ok || !json || json.ok === false) {
        return null;
      }
      const { service, checklist } = json;
      const status = service.status ?? "";
      const andamento = Number.isFinite(service.realPercent) ? Number(service.realPercent ?? 0) : 0;
      return {
        id: service.id,
        os: service.os,
        tag: service.tag,
        equipamento: service.equipmentName,
        cnpj: service.cnpj ?? null,
        andamento,
        status,
        hasChecklist: Boolean(service.hasChecklist && checklist.length > 0),
        checklist: checklist.map((item) => ({
          id: item.id,
          description: item.description,
          weight: Number(item.weight ?? 0),
          progress: Number(item.progress ?? 0),
        })),
      };
    } catch (error) {
      console.error("[acesso] Falha ao carregar serviço", error);
      return null;
    }
  }, []);

  const loadServices = useCallback(
    async (tokenValue: string, serviceIds: string[]) => {
      setLoadingServices(true);
      try {
        const entries = await Promise.all(serviceIds.map((id) => fetchService(tokenValue, id)));
        const validServices = entries.filter((service): service is ServiceSummary => Boolean(service));
        const onlyOpen = validServices.filter((service) => isServiceOpen(service));
        
        // Se não encontrou serviços abertos, mas há serviços válidos, usar os válidos
        // (pode ser que o status mudou ou há uma inconsistência)
        const servicesToShow = onlyOpen.length > 0 ? onlyOpen : validServices;
        
        setServices(servicesToShow);
        if (servicesToShow.length > 0) {
          setSelectedServiceId(servicesToShow[0].id);
        } else {
          setSelectedServiceId(null);
        }
        setShowAllServicesList(false);
      } finally {
        setLoadingServices(false);
      }
    },
    [fetchService],
  );

  const visibleServices = useMemo(() => {
    if (showAllServicesList) {
      return services;
    }
    return services.slice(0, MAX_VISIBLE_SERVICES);
  }, [services, showAllServicesList]);

  const hasServiceToggle = services.length > MAX_VISIBLE_SERVICES;

  const validateToken = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim().toUpperCase();
      if (!code) return;
      setValidating(true);
      setValidationError(null);
      setServices([]);
      setSelectedServiceId(null);
      setShowAllServicesList(false);
      let didRedirect = false;
      try {
        const response = await fetch(`/api/validate-token?token=${encodeURIComponent(code)}`, {
          cache: "no-store",
        });
        const json: ValidateSuccess | ValidateError = await response.json();
        if (!response.ok || !json || json.ok === false) {
          setValidatedToken(null);
          toast.error("Token inválido ou expirado.");
          setValidationError("Token inválido ou expirado.");
          recordTelemetry("token.validation.failure", { status: response.status, error: json?.error });
          return;
        }

        const serviceIds = "serviceIds" in json ? json.serviceIds : [];
        
        if (json.ok && json.found) {
          await persistTokenSession(code);
          recordTelemetry("token.validation.success", { services: serviceIds.length });
          const targetType = json.targetType;
          const targetId = json.targetId ?? null;
          const redirectPath = (() => {
            if (targetType === "folder" && targetId) {
              return `/subpacotes/${encodeURIComponent(targetId)}?token=${encodeURIComponent(code)}`;
            }
            if (targetType === "service" && targetId) {
              return `/s/${encodeURIComponent(targetId)}?token=${encodeURIComponent(code)}`;
            }
            return "/terceiro";
          })();
          toast.success("Token válido! Redirecionando…");
          didRedirect = true;
          router.replace(redirectPath);
          return;
        }

        if (serviceIds.length === 0) {
          setValidatedToken(code);
          toast.info("Token válido, mas nenhum serviço aberto foi encontrado.");
          setValidationError("Nenhum serviço aberto encontrado para este token.");
          recordTelemetry("token.validation.success", { services: 0 });
          return;
        }

        setValidatedToken(code);
        recordTelemetry("token.validation.success", { services: serviceIds.length });
        toast.success("Token validado. Selecione um serviço para atualizar.");
        await loadServices(code, serviceIds);
      } catch (error) {
        console.error("[acesso] Falha ao validar token", error);
        setValidatedToken(null);
        toast.error("Falha ao validar token.");
        setValidationError("Não foi possível validar o token no momento.");
      } finally {
        if (!didRedirect) {
          setValidating(false);
        }
      }
    },
    [loadServices, persistTokenSession, router],
  );

  const handleValidate = useCallback(
    async (event?: FormEvent<HTMLFormElement>) => {
      event?.preventDefault();
      await validateToken(token);
    },
    [token, validateToken],
  );

  useEffect(() => {
    setToken(initial);
    if (initial) {
      void validateToken(initial);
    }
  }, [initial, validateToken]);

  function updateChecklistValue(id: string, value: number) {
    setChecklistValues((prev) => ({ ...prev, [id]: Math.max(0, Math.min(100, Math.round(value))) }));
  }

  async function refreshService(serviceId: string) {
    if (!validatedToken) return;
    const updated = await fetchService(validatedToken, serviceId);
    if (!updated) return;
    setServices((prev) => prev.map((service) => (service.id === serviceId ? updated : service)));
    if (selectedServiceId === serviceId) {
      setSelectedServiceId(serviceId);
    }
  }

  async function submitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!validatedToken || !selectedService) return;

    const manualInput = manualPercent.trim();
    const hasChecklistItems = selectedService.hasChecklist && selectedService.checklist.length > 0;
    const parsedManual = manualInput === "" ? null : Number(manualInput);

    if (manualInput !== "" && (!Number.isFinite(parsedManual) || parsedManual < 0 || parsedManual > 100)) {
      toast.error("Informe um percentual entre 0 e 100.");
      return;
    }

    const normalizedManual =
      manualInput === "" ? undefined : Math.max(0, Math.min(100, Number(parsedManual ?? 0)));

    if (hasChecklistItems) {
      const itemsPayload = selectedService.checklist.map((item) => ({
        itemId: item.id,
        pct: Math.max(0, Math.min(100, Number(checklistValues[item.id] ?? 0))),
      }));
      // Calcular percentual total baseado no checklist
      let calculatedPercent = 0;
      let totalWeight = 0;
      itemsPayload.forEach((item) => {
        const checklistItem = selectedService.checklist.find((ci) => ci.id === item.itemId);
        const weight = checklistItem?.weight ?? 1;
        calculatedPercent += (item.pct * weight) / 100;
        totalWeight += weight;
      });
      const finalPercent = totalWeight > 0 ? Math.round((calculatedPercent / totalWeight) * 100) : 0;
      const body: Record<string, unknown> = {
        token: validatedToken,
        serviceId: selectedService.id,
        items: itemsPayload,
        totalPct: finalPercent,
        note: note.trim() ? note.trim() : undefined,
      };
      await sendUpdate(body);
    } else {
      if (typeof normalizedManual !== "number") {
        toast.error("Informe o percentual concluído do serviço (0 a 100%).");
        return;
      }
      const body = {
        token: validatedToken,
        serviceId: selectedService.id,
        totalPct: normalizedManual,
        note: note.trim() ? note.trim() : undefined,
      };
      await sendUpdate(body);
    }
    await refreshService(selectedService.id);
  }

  async function sendUpdate(body: Record<string, unknown>) {
    setSavingUpdate(true);
    try {
      const response = await fetch("/api/progresso/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error ? String(errorBody.error) : "Falha ao enviar atualização.";
        toast.error(message);
        return;
      }
      toast.success("Atualização registrada com sucesso.");
      setNote("");
    } catch (error) {
      console.error("[acesso] Falha ao enviar atualização", error);
      toast.error("Não foi possível enviar a atualização.");
    } finally {
      setSavingUpdate(false);
    }
  }

  return (
    <div className="container-page max-w-4xl pb-16">
      <Link href="/" className="link inline-flex items-center gap-1 mb-4">
        ← Voltar
      </Link>

      <div className="mt-4 card bg-card/60 p-6 shadow-sm backdrop-blur">
        <h1 className="mb-1">Acesso do Terceiro</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          Informe o código recebido para visualizar seus serviços e registrar o andamento.
        </p>

        <form onSubmit={handleValidate} className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <label htmlFor="token" className="text-sm font-medium text-foreground/90">
              Código do token
            </label>
            <input
              id="token"
              name="token"
              value={token}
              onChange={(event) => setToken(event.target.value.toUpperCase())}
              placeholder="EX: RFHX9T86"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              aria-invalid={Boolean(validationError)}
              className="input"
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary h-11 px-5 sm:ml-3"
            aria-busy={validating}
            disabled={validating || !token}
          >
            {validating ? "Validando..." : "Validar token"}
          </button>
        </form>
        {validationError ? <p className="mt-2 text-sm text-amber-600">{validationError}</p> : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,280px)_1fr]">
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Serviços abertos</h2>
            <div className="space-y-2">
              {loadingServices ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">Carregando serviços...</div>
              ) : services.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Nenhum serviço disponível no momento.
                </div>
              ) : (
                <>
                  {visibleServices.map((service) => {
                    const isActive = service.id === selectedServiceId;
                    return (
                      <button
                        key={service.id}
                        type="button"
                        onClick={() => setSelectedServiceId(service.id)}
                        className={`btn btn-outline min-h-[44px] w-full flex flex-col items-start gap-1 text-left py-3 ${
                          isActive ? "border-primary bg-primary/10" : ""
                        }`}
                      >
                        <div className="flex w-full items-center justify-between text-sm font-semibold">
                          <span>{service.os || "Sem O.S"}</span>
                          <span className="text-xs font-medium text-muted-foreground">{formatPercent(service.andamento)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <div>Tag: {service.tag || "—"}</div>
                          <div>Equipamento: {service.equipamento || "—"}</div>
                      <div>CNPJ: {service.cnpj || "—"}</div>
                        </div>
                      </button>
                    );
                  })}
                  {hasServiceToggle ? (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                      <span>
                        Mostrando {visibleServices.length} de {services.length} serviço{services.length === 1 ? "" : "s"}.
                      </span>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => setShowAllServicesList((prev) => !prev)}
                      >
                        {showAllServicesList ? "Mostrar menos" : "Mostrar mais"}
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          </div>

          <div className="card bg-background/80 p-4 shadow-inner">
            {selectedService ? (
              <form onSubmit={submitUpdate} className="space-y-4" aria-live="polite">
                <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">O.S:</span>
                    <span>{selectedService.os || "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">CNPJ:</span>
                    <span>{selectedService.cnpj || "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">Tag:</span>
                    <span>{selectedService.tag || "—"}</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">Equipamento:</span>
                    <span>{selectedService.equipamento || "—"}</span>
                  </div>
                </div>
                <div>
                  <h2 className="text-base font-semibold">Atualizar serviço</h2>
                  <p className="text-xs text-muted-foreground">
                    Informe o progresso atual e descreva (se desejar) o que foi executado nesta etapa.
                  </p>
                </div>

                {selectedService.hasChecklist && selectedService.checklist.length > 0 ? (
                  <div className="space-y-4">
                    {selectedService.checklist.map((item) => (
                      <RangeItem
                        key={item.id}
                        id={`item-${item.id}`}
                        label={`${item.description} (peso ${item.weight}%)`}
                        value={checklistValues[item.id] ?? 0}
                        onChange={(value) => updateChecklistValue(item.id, value)}
                      />
                    ))}
                    <p className="text-xs text-muted-foreground">
                      O percentual total será calculado automaticamente com base nos valores do checklist acima.
                    </p>
                  </div>
                ) : (
                  <Field
                    label="Percentual concluído"
                    type="number"
                    min={Math.max(0, Math.min(100, Number(selectedService.andamento ?? 0)))}
                    max={100}
                    step={1}
                    value={manualPercent}
                    onChange={(event) => setManualPercent(event.target.value)}
                    required={true}
                    hint={`Informe um percentual entre ${Math.max(0, Math.min(100, Number(selectedService.andamento ?? 0)))} e 100%.`}
                    className="input"
                  />
                )}

                <div className="space-y-1">
                  <label htmlFor="note" className="text-sm font-medium text-foreground/90">
                    Descrição do que foi feito (opcional)
                  </label>
                  <textarea
                    id="note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    rows={4}
                    className="textarea"
                    placeholder="Detalhes relevantes desta atualização"
                  />
                </div>

                <button
                  type="submit"
                  className="btn btn-primary h-11 px-5 w-full sm:w-auto"
                  aria-busy={savingUpdate}
                  disabled={savingUpdate}
                >
                  {savingUpdate ? "Enviando..." : "Enviar atualização"}
                </button>
              </form>
            ) : (
              <div className="flex min-h-[220px] items-center justify-center rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
                Valide um token e selecione um serviço para registrar o progresso.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
