"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";

import ServiceUpdateForm, { type ServiceUpdateFormPayload } from "@/components/ServiceUpdateForm";
import { dedupeUpdates, formatResourcesLine, sanitiseResourceQuantities } from "@/lib/serviceUpdates";
import { formatDate as formatDateOnly, formatDateTime } from "@/lib/formatDateTime";
import { useFirebaseAuthSession } from "@/lib/useFirebaseAuthSession";
import { isPCMUser } from "@/lib/pcmAuth";

import type { ThirdChecklistItem, ThirdService, ThirdServiceUpdate } from "@/app/(third)/terceiro/servico/[id]/types";
import { cn } from "@/lib/utils";

type ServiceDetailsClientProps = {
  service: ThirdService;
  updates: ThirdServiceUpdate[];
  checklist: ThirdChecklistItem[];
  allowCompletion?: boolean;
  token?: string;
};

const MAX_UPDATES = 20;

const DEFAULT_TIME_ZONE = "America/Sao_Paulo";

function clampPercent(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(100, Math.max(0, numeric));
}

function formatDateLabel(value?: number | string | null, withTime = false): string {
  if (value === null || value === undefined) return "-";
  const input = typeof value === "number" ? value : String(value);
  if (withTime) {
    return formatDateTime(input, { timeZone: DEFAULT_TIME_ZONE, fallback: "-" }) || "-";
  }
  return formatDateOnly(input, { timeZone: DEFAULT_TIME_ZONE, fallback: "-" }) || "-";
}

function normaliseStatus(value: string | null | undefined): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw === "concluido" || raw === "concluído" || raw === "encerrado") return "Concluído";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

function formatChecklistStatus(status: ThirdChecklistItem["status"]): string {
  if (status === "concluido") return "Concluído";
  if (status === "em-andamento") return "Em andamento";
  return "Não iniciado";
}

function statusFromProgress(progress: number): ThirdChecklistItem["status"] {
  if (progress >= 100) return "concluido";
  if (progress <= 0) return "nao-iniciado";
  return "em-andamento";
}

function statusToApi(status: ThirdChecklistItem["status"]): "nao_iniciado" | "andamento" | "concluido" {
  if (status === "concluido") return "concluido";
  if (status === "em-andamento") return "andamento";
  return "nao_iniciado";
}

function normaliseChecklistItems(items: ThirdChecklistItem[]): ThirdChecklistItem[] {
  return items.map((item) => ({
    ...item,
    weight: Number.isFinite(item.weight) ? Number(item.weight) : 0,
    progress: clampPercent(item.progress ?? 0),
    status: item.status ?? "nao-iniciado",
  }));
}

function resolveReopenedProgress(service: ThirdService): number | null {
  const rawStatus = String(service.status ?? "").trim().toLowerCase();
  if (rawStatus !== "pendente") return null;

  const source = service as Record<string, unknown>;
  const canonicalProgress = [service.andamento, service.realPercent, service.manualPercent]
    .find((value) => typeof value === "number" && Number.isFinite(value));
  if (typeof canonicalProgress === "number" && canonicalProgress < 100) {
    return null;
  }
  const candidates = [source.previousProgress, source.progressBeforeConclusion, source.previousPercent];

  for (const candidate of candidates) {
    const parsed = Number(candidate);
    if (!Number.isFinite(parsed)) continue;
    const clamped = clampPercent(parsed);
    if (clamped < 100) {
      return clamped;
    }
  }

  return null;
}

function computeInitialProgress(service: ThirdService, updates: ThirdServiceUpdate[]): number {
  const reopenedProgress = resolveReopenedProgress(service);
  if (reopenedProgress !== null) {
    return reopenedProgress;
  }

  // Prioridade 1: realPercentSnapshot (valor mais recente lançado pelo terceiro)
  const serviceRecord = service as Record<string, unknown>;
  const realPercentSnapshot = typeof serviceRecord.realPercentSnapshot === "number" && Number.isFinite(serviceRecord.realPercentSnapshot)
    ? serviceRecord.realPercentSnapshot
    : null;
  if (realPercentSnapshot !== null) {
    return clampPercent(realPercentSnapshot);
  }

  // Prioridade 2: manualPercent (valor digitado manualmente)
  if (typeof service.manualPercent === "number" && Number.isFinite(service.manualPercent)) {
    return clampPercent(service.manualPercent);
  }

  // Prioridade 3: realPercent (valor real calculado)
  if (typeof service.realPercent === "number" && Number.isFinite(service.realPercent)) {
    return clampPercent(service.realPercent);
  }

  // Prioridade 4: updates mais recentes
  if (updates.length > 0) {
    return clampPercent(updates[0]?.percent ?? 0);
  }

  // Prioridade 5: outros campos
  const candidates = [service.andamento, service.previousProgress];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return clampPercent(value);
    }
  }

  return 0;
}

function computeChecklistSuggestion(checklist: ThirdChecklistItem[]): number | undefined {
  if (!Array.isArray(checklist) || checklist.length === 0) return undefined;
  let weighted = 0;
  let totalWeight = 0;
  checklist.forEach((item) => {
    const weight = Number(item.weight ?? 0);
    const progress = Number(item.progress ?? 0);
    if (!Number.isFinite(weight) || !Number.isFinite(progress)) return;
    weighted += weight * progress;
    totalWeight += weight;
  });
  if (!totalWeight) return undefined;
  return Math.round((weighted / totalWeight) * 10) / 10;
}

function computeTimeWindowHours(update: ThirdServiceUpdate): number | null {
  const raw = update.timeWindow?.hours;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.round(raw * 100) / 100;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed * 100) / 100;
    }
  }
  const start = update.timeWindow?.start;
  const end = update.timeWindow?.end;
  if (start === null || start === undefined || end === null || end === undefined) return null;
  const startDate = new Date(start);
  const endDate = new Date(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
  const diff = (endDate.getTime() - startDate.getTime()) / 3_600_000;
  if (!Number.isFinite(diff) || diff < 0) return null;
  return Math.round(diff * 100) / 100;
}

function shouldDisplayUpdate(update: ThirdServiceUpdate): boolean {
  const hasStart = update.timeWindow?.start !== null && update.timeWindow?.start !== undefined;
  const hasDescription = Boolean(update.description && update.description.trim());
  const hasDetails =
    (Array.isArray(update.resources) && update.resources.length > 0) ||
    (Array.isArray(update.workforce) && update.workforce.length > 0) ||
    (Array.isArray(update.impediments) && update.impediments.length > 0) ||
    (Array.isArray(update.shiftConditions) && update.shiftConditions.length > 0);
  const hasHours = computeTimeWindowHours(update) !== null;

  return hasStart || hasDescription || hasDetails || hasHours;
}

function buildThirdUpdateSummary(update: ThirdServiceUpdate) {
  const title = formatDateLabel(update.timeWindow?.start ?? update.createdAt ?? null);
  const percentLabel = `${Math.round(update.percent)}%`;
  const description = update.description ? `Descrição do dia: ${update.description}` : null;
  const hours = computeTimeWindowHours(update);
  const hoursLabel = hours !== null && Math.abs(hours - 24) > 0.01 ? `Horas informadas: ${hours.toFixed(2)}` : null;
  const resourcesLabel = update.resources && update.resources.length ? formatResourcesLine(update.resources) : null;
  return { title, percentLabel, description, hoursLabel, resourcesLabel };
}

const SHIFT_LABELS = {
  manha: "Manhã",
  tarde: "Tarde",
  noite: "Noite",
} as const satisfies Record<"manha" | "tarde" | "noite", string>;

const WEATHER_LABELS = {
  claro: "Claro",
  nublado: "Nublado",
  chuvoso: "Chuvoso",
} as const satisfies Record<"claro" | "nublado" | "chuvoso", string>;

const CONDITION_LABELS = {
  praticavel: "Praticável",
  impraticavel: "Impraticável",
} as const satisfies Record<"praticavel" | "impraticavel", string>;

function getShiftLabel(value?: string | null) {
  if (!value) return "";
  const key = value.toLowerCase() as keyof typeof SHIFT_LABELS;
  return SHIFT_LABELS[key] ?? value;
}

function getWeatherLabel(value?: string | null) {
  if (!value) return "";
  const key = value.toLowerCase() as keyof typeof WEATHER_LABELS;
  return WEATHER_LABELS[key] ?? value;
}

function getConditionLabel(value?: string | null) {
  if (!value) return "";
  const key = value.toLowerCase() as keyof typeof CONDITION_LABELS;
  return CONDITION_LABELS[key] ?? value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toNullableNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
    const parsed = new Date(value);
    const time = parsed.getTime();
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function toThirdUpdate(update: unknown): ThirdServiceUpdate {
  const record = isRecord(update) ? update : {};
  const timeWindowRecord = isRecord(record.timeWindow) ? record.timeWindow : null;
  const timeWindowCandidate = timeWindowRecord
    ? {
        start: toNullableNumber(timeWindowRecord.start),
        end: toNullableNumber(timeWindowRecord.end),
        hours: toNullableNumber(timeWindowRecord.hours),
      }
    : undefined;
  const timeWindow =
    timeWindowCandidate &&
    timeWindowCandidate.start === null &&
    timeWindowCandidate.end === null &&
    timeWindowCandidate.hours === null
      ? undefined
      : timeWindowCandidate;

  const subactivityRecord = isRecord(record.subactivity) ? record.subactivity : null;
  const subactivity = subactivityRecord
    ? {
        id: toOptionalString(subactivityRecord.id) ?? null,
        label: toOptionalString(subactivityRecord.label) ?? null,
      }
    : undefined;

  const workforce = Array.isArray(record.workforce)
    ? record.workforce
        .map((item) => {
          if (!isRecord(item)) return null;
          const role = toOptionalString(item.role);
          if (!role) return null;
          const quantityValue =
            typeof item.quantity === "number"
              ? item.quantity
              : typeof item.quantity === "string"
                ? Number(item.quantity)
                : undefined;
          const numeric =
            quantityValue !== undefined && Number.isFinite(quantityValue)
              ? Math.max(1, Math.round(Number(quantityValue)))
              : 1;
          return { role, quantity: numeric };
        })
        .filter(isPresent)
    : undefined;

  const shiftConditions = Array.isArray(record.shiftConditions)
    ? record.shiftConditions
        .map((item) => {
          if (!isRecord(item)) return null;
          const shiftRaw = toOptionalString(item.shift)?.toLowerCase();
          const weatherRaw = toOptionalString(item.weather)?.toLowerCase();
          const conditionRaw = toOptionalString(item.condition)?.toLowerCase();
          if (!shiftRaw || !weatherRaw || !conditionRaw) return null;
          if (!SHIFT_LABELS[shiftRaw as keyof typeof SHIFT_LABELS]) return null;
          if (!WEATHER_LABELS[weatherRaw as keyof typeof WEATHER_LABELS]) return null;
          if (!CONDITION_LABELS[conditionRaw as keyof typeof CONDITION_LABELS]) return null;
          return {
            shift: shiftRaw as "manha" | "tarde" | "noite",
            weather: weatherRaw as "claro" | "nublado" | "chuvoso",
            condition: conditionRaw as "praticavel" | "impraticavel",
          };
        })
        .filter(isPresent)
    : undefined;

  const impediments = Array.isArray(record.impediments)
    ? record.impediments
        .map((item) => {
          if (!isRecord(item)) return null;
          const type = toOptionalString(item.type);
          if (!type) return null;
          return { type, durationHours: toNullableNumber(item.durationHours) };
        })
        .filter(isPresent)
    : undefined;

  const resources = Array.isArray(record.resources)
    ? record.resources
        .map((item) => {
          if (!isRecord(item)) return null;
          const name = toOptionalString(item.name);
          if (!name) return null;
          return {
            name,
            quantity: toNullableNumber(item.quantity),
            unit: toOptionalString(item.unit) ?? null,
          };
        })
        .filter(isPresent)
    : undefined;

  const evidences = Array.isArray(record.evidences)
    ? record.evidences
        .map((item) => {
          if (!isRecord(item)) return null;
          const url = toOptionalString(item.url);
          if (!url) return null;
          return { url, label: toOptionalString(item.label) ?? null };
        })
        .filter(isPresent)
    : undefined;

  const previousPercent = toNullableNumber(record.previousPercent);

  return {
    id: String(record.id ?? crypto.randomUUID()),
    percent: clampPercent(record.percent ?? record.realPercentSnapshot ?? record.manualPercent ?? 0),
    description:
      typeof record.description === "string"
        ? record.description
        : typeof record.note === "string"
          ? record.note
          : undefined,
    createdAt: toTimestampMs(record.createdAt ?? record.createdAtMillis ?? record.createdAtMs ?? undefined),
    submittedAt: toTimestampMs(
      (isRecord(record.audit) ? record.audit.submittedAt : null) ?? record.submittedAt ?? undefined,
    ),
    timeWindow,
    subactivity,
    mode: record.mode === "detailed" || record.mode === "simple" ? record.mode : undefined,
    impediments,
    resources,
    workforce,
    shiftConditions,
    forecastDate: toNullableNumber(record.forecastDate),
    criticality: toNullableNumber(record.criticality),
    evidences,
    justification: toOptionalString(record.justification) ?? null,
    previousPercent: previousPercent ?? null,
    declarationAccepted:
      typeof record.declarationAccepted === "boolean" ? record.declarationAccepted : undefined,
  };
}

export default function ServiceDetailsClient({
  service,
  updates: initialUpdates,
  checklist,
  token,
}: ServiceDetailsClientProps) {
  const safeInitialUpdates = useMemo(
    () => (Array.isArray(initialUpdates) ? initialUpdates : []),
    [initialUpdates],
  );
  const safeChecklist = useMemo(
    () => (Array.isArray(checklist) ? checklist : []),
    [checklist],
  );

  const normalisedInitialUpdates = useMemo(
    () => dedupeUpdates(safeInitialUpdates.map((item) => sanitiseResourceQuantities(item))).slice(0, MAX_UPDATES),
    [safeInitialUpdates],
  );

  const [updates, setUpdates] = useState(normalisedInitialUpdates);
  useEffect(() => {
    setUpdates(normalisedInitialUpdates);
  }, [normalisedInitialUpdates]);
  useEffect(() => {
    setProgress(computeInitialProgress(service, normalisedInitialUpdates));
  }, [service, normalisedInitialUpdates]);
  const recentUpdates = useMemo(() => updates.filter(shouldDisplayUpdate), [updates]);
  const [serviceStatus, setServiceStatus] = useState(service.status);
  const [progress, setProgress] = useState(() => computeInitialProgress(service, normalisedInitialUpdates));
  const [checklistItems, setChecklistItems] = useState<ThirdChecklistItem[]>(() =>
    normaliseChecklistItems(safeChecklist),
  );
  useEffect(() => {
    setChecklistItems(normaliseChecklistItems(safeChecklist));
  }, [safeChecklist]);

  const serviceLabel = useMemo(() => {
    if (service.os && service.os.trim()) return service.os.trim();
    if (service.code && service.code.trim()) return service.code.trim();
    return service.id;
  }, [service]);

  const companyLabel = useMemo(() => {
    if (service.company && service.company.trim()) return service.company.trim();
    return null;
  }, [service.company]);

  const signatureCompanyLabel = useMemo(() => {
    if (companyLabel && companyLabel.trim()) return companyLabel.trim();
    if (service.empresa && service.empresa.trim()) return service.empresa.trim();
    return null;
  }, [companyLabel, service.empresa]);

  const signatureCnpjLabel = useMemo(() => {
    if (typeof service.cnpj !== "string") return null;
    const trimmed = service.cnpj.trim();
    return trimmed.length > 0 ? trimmed : null;
  }, [service.cnpj]);

  const lastUpdateAt =
    updates[0]?.audit?.submittedAt ?? updates[0]?.submittedAt ?? updates[0]?.createdAt ?? service.updatedAt ?? null;
  const suggestion = useMemo(() => computeChecklistSuggestion(checklistItems), [checklistItems]);
  const canonicalProgress = useMemo(() => {
    // Prioridade 1: realPercentSnapshot (valor mais recente lançado pelo terceiro)
    const serviceRecord = service as Record<string, unknown>;
    const realPercentSnapshot = typeof serviceRecord.realPercentSnapshot === "number" && Number.isFinite(serviceRecord.realPercentSnapshot)
      ? serviceRecord.realPercentSnapshot
      : null;
    if (realPercentSnapshot !== null) {
      return clampPercent(realPercentSnapshot);
    }

    // Prioridade 2: progress (já calculado com prioridade correta)
    if (Number.isFinite(progress)) {
      return clampPercent(progress);
    }

    // Prioridade 3: checklist calculado (apenas se não houver progress direto)
    if (service.hasChecklist && Number.isFinite(suggestion ?? NaN)) {
      return clampPercent(suggestion ?? 0);
    }

    return 0;
  }, [progress, service, suggestion]);
  const checklistOptions = useMemo(
    () =>
      checklistItems.map((item) => ({
        id: item.id,
        description: item.description,
        progress: item.progress,
        weight: item.weight,
      })),
    [checklistItems],
  );

  const recentChecklist = useMemo(
    () =>
      [...checklistItems].sort((a, b) => {
        const left = typeof a.updatedAt === "number" ? a.updatedAt : 0;
        const right = typeof b.updatedAt === "number" ? b.updatedAt : 0;
        return right - left;
      }),
    [checklistItems],
  );

  useEffect(() => {
    setChecklistItems(normaliseChecklistItems(safeChecklist));
  }, [safeChecklist]);

  useEffect(() => {
    setServiceStatus(service.status);
  }, [service.status]);

  const statusLabel = useMemo(() => {
    const normalised = normaliseStatus(serviceStatus);
    if (normalised === "Pendente") return normalised;
    if (canonicalProgress >= 100) return "Concluído";
    return normalised;
  }, [canonicalProgress, serviceStatus]);

  const isServiceOpen = useMemo(() => {
    const rawStatus = String(serviceStatus ?? "").toLowerCase();
    return rawStatus === "aberto" || rawStatus === "pendente";
  }, [serviceStatus]);

  const detailItems = useMemo(
    () => [
      { label: "Status", value: statusLabel },
      { label: "Andamento", value: `${canonicalProgress.toFixed(1)}%` },
      { label: "Código", value: service.code?.trim() || "—" },
      { label: "Ordem de compra", value: service.oc?.trim() || "—" },
      { label: "Tag", value: service.tag?.trim() || "—" },
      { label: "Equipamento", value: service.equipmentName?.trim() || "—" },
      { label: "Setor", value: service.sector?.trim() || "—" },
      {
        label: "Horas totais",
        value:
          typeof service.totalHours === "number" && Number.isFinite(service.totalHours)
            ? service.totalHours
            : "—",
      },
      { label: "Início planejado", value: formatDateLabel(service.plannedStart) },
      { label: "Fim planejado", value: formatDateLabel(service.plannedEnd) },
      { label: "Empresa atribuída", value: companyLabel || "—" },
      { label: "CNPJ", value: service.cnpj?.trim() || "—" },
      { label: "Última atualização", value: formatDateLabel(lastUpdateAt, true) },
    ],
    [service, canonicalProgress, lastUpdateAt, companyLabel, statusLabel],
  );

  const documentMetaItems = useMemo(
    () => [
      { label: "FO 012 050 33", highlight: true },
      { label: "Páginas 1/1" },
      { label: "Emissão 08/04/2024" },
      { label: "Revisão 05/07/2024" },
      { label: "Nº 1" },
    ],
    [],
  );

  const trimmedToken = token?.trim() ?? "";
  const { user: authUser, ready: authReady } = useFirebaseAuthSession();
  const canEditUpdates = authReady && authUser?.email && !trimmedToken ? isPCMUser(authUser.email) : false;

  const submitChecklistUpdates = useCallback(
    async (
      subactivities: ServiceUpdateFormPayload["subactivities"],
    ): Promise<number | null> => {
      if (!service.hasChecklist || !Array.isArray(subactivities) || subactivities.length === 0) {
        return null;
      }

      const updatesPayload = subactivities
        .map((item) => {
          if (typeof item.progress !== "number" || !Number.isFinite(item.progress)) {
            return null;
          }
          const rounded = Math.max(0, Math.min(100, Math.round(item.progress)));
          return {
            id: item.id,
            progress: rounded,
            status: statusToApi(statusFromProgress(rounded)),
          };
        })
        .filter((item): item is { id: string; progress: number; status: "nao_iniciado" | "andamento" | "concluido" } =>
          Boolean(item?.id),
        );

      if (updatesPayload.length === 0) {
        return null;
      }

      const url = new URL(`/api/public/service/update-checklist`, window.location.origin);
      url.searchParams.set("serviceId", service.id);
      if (trimmedToken) {
        url.searchParams.set("token", trimmedToken);
      }

      const response = await fetch(url.toString(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // O envio completo logo abaixo cria o único RDO deste preenchimento.
        // Registrar outro documento aqui gerava um espelho com apenas
        // realPercentSnapshot/token; ao excluir o RDO completo, esse espelho
        // permanecia e restaurava o percentual antigo.
        body: JSON.stringify({ updates: updatesPayload, recordUpdate: false }),
      });

      const json = (await response.json().catch(() => null)) as
        | { ok?: boolean; error?: string; realPercent?: number }
        | null;

      if (!response.ok || !json?.ok) {
        const message = json?.error ?? "Não foi possível salvar o checklist.";
        throw new Error(message);
      }

      const updatesMap = new Map(updatesPayload.map((item) => [item.id, item]));
      setChecklistItems((prev) =>
        prev.map((item) => {
          const update = updatesMap.get(item.id);
          if (!update) return item;
          return {
            ...item,
            progress: update.progress,
            status: statusFromProgress(update.progress),
            updatedAt: Date.now(),
          };
        }),
      );

      if (json?.realPercent !== undefined) {
        const numericPercent = Number(json.realPercent);
        if (Number.isFinite(numericPercent)) {
          return clampPercent(numericPercent);
        }
      }

      return null;
    },
    [service.hasChecklist, service.id, trimmedToken],
  );


  const uploadEvidencePhoto = useCallback(async (file: File) => {
    const url = new URL(`/api/public/service/upload-evidence`, window.location.origin);
    url.searchParams.set("serviceId", service.id);
    if (trimmedToken) {
      url.searchParams.set("token", trimmedToken);
    }

    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(url.toString(), {
      method: "POST",
      body: formData,
    });
    const json = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; evidence?: { url: string; label?: string } } | null;
    if (!response.ok || !json?.ok || !json.evidence) {
      throw new Error(json?.error ?? "Não foi possível enviar a foto.");
    }
    return json.evidence;
  }, [service.id, trimmedToken]);

  const handleUpdateSubmit = useCallback(
    async (payload: ServiceUpdateFormPayload) => {
      const initialPercent = clampPercent(payload.percent);
      let percentToSend = initialPercent;
      try {
        const checklistPercent = await submitChecklistUpdates(payload.subactivities);
        if (typeof checklistPercent === "number" && Number.isFinite(checklistPercent)) {
          // Só substituir pelo cálculo do checklist quando o usuário não alterou manualmente o percentual.
          // Caso contrário, preservar exatamente o valor digitado.
          const baseline = clampPercent(canonicalProgress);
          const unchanged = Math.abs(initialPercent - baseline) < 1e-6;
          if (unchanged) {
            percentToSend = clampPercent(checklistPercent);
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Não foi possível salvar o checklist.";
        toast.error(message);
        throw error instanceof Error ? error : new Error(message);
      }


      const url = new URL(`/api/public/service/update-manual`, window.location.origin);
      url.searchParams.set("serviceId", service.id);
      if (trimmedToken) {
        url.searchParams.set("token", trimmedToken);
      }

      const resourcesPayload = payload.resources.map((item) => ({
        name: item.name,
        quantity: null,
        unit: null,
      }));

      const startDate = new Date(payload.start);
      const endDate = new Date(payload.end);
      const reportDateMillis = (() => {
        if (typeof payload.reportDate === "number" && Number.isFinite(payload.reportDate)) {
          return payload.reportDate;
        }
        const fallback = new Date(`${payload.date}T12:00:00Z`);
        if (Number.isFinite(fallback.getTime())) return fallback.getTime();
        if (Number.isFinite(startDate.getTime())) return startDate.getTime();
        return Date.now();
      })();
      const durationHours = Number.isFinite(startDate.getTime()) && Number.isFinite(endDate.getTime())
        ? Math.max(0, Math.round(((endDate.getTime() - startDate.getTime()) / 3_600_000) * 100) / 100)
        : null;

      const body: Record<string, unknown> = {
        evidences: payload.evidences,
        percent: percentToSend,
        description: payload.description,
        timeWindow: {
          start: payload.start,
          end: payload.end,
          hours: durationHours ?? undefined,
        },
        mode: "simple",
        resources: resourcesPayload,
        workforce: payload.workforce,
        shiftConditions: payload.shiftConditions,
        declarationAccepted: payload.declarationAccepted,
        reportDate: reportDateMillis,
      };

      let errorMessage = "Não foi possível registrar a atualização.";

      try {
        const response = await fetch(url.toString(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

        const json = (await response.json().catch(() => null)) as
          | { ok?: boolean; error?: string; realPercent?: number; update?: unknown }
          | null;

        if (!response.ok || !json?.ok) {
          errorMessage = json?.error ?? errorMessage;
          throw new Error(errorMessage);
        }

        const nextPercent = clampPercent(
          Number.isFinite(json.realPercent) ? Number(json.realPercent) : percentToSend,
        );

        if (json.update) {
          const mapped = sanitiseResourceQuantities(toThirdUpdate(json.update));
          setUpdates((prev) => {
            const filtered = prev.filter((item) => item.id !== mapped.id);
            return dedupeUpdates([mapped, ...filtered]).slice(0, MAX_UPDATES);
          });
        } else {
          const createdAt = reportDateMillis || Date.now();
          const submittedAt = Date.now();
          setUpdates((prev) => {
            const optimistic = sanitiseResourceQuantities({
              id: `local-${createdAt}`,
              percent: nextPercent,
              description: payload.description,
              createdAt,
              submittedAt,
              timeWindow: {
                start: startDate.getTime(),
                end: endDate.getTime(),
                hours: durationHours,
              },
              mode: "simple",
              resources: resourcesPayload,
              workforce: payload.workforce,
              shiftConditions: payload.shiftConditions,
              previousPercent: canonicalProgress,
              declarationAccepted: true,
              evidences: payload.evidences,
            });
            return dedupeUpdates([optimistic, ...prev]).slice(0, MAX_UPDATES);
          });
        }

        setProgress(nextPercent);
        toast.success("Atualização registrada com sucesso!");
      } catch (error) {
        console.error("[service-details] Falha ao registrar atualização", error);
        toast.error(errorMessage);
        throw error instanceof Error ? error : new Error(errorMessage);
      }
    },
    [canonicalProgress, service.id, submitChecklistUpdates, trimmedToken],
  );

  return (
    <div className="space-y-8">
      <div className="card overflow-hidden">
        <div className="grid gap-6 bg-gradient-to-b from-primary/5 via-transparent to-transparent p-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-primary">Portal do Terceiro</p>
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-foreground">OS: {serviceLabel}</h1>
              <p className="text-sm text-muted-foreground">Formulário único para atualização diária do serviço.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[0.65rem] uppercase tracking-[0.25em] text-muted-foreground">
              {documentMetaItems.map((item) => (
                <span
                  key={item.label}
                  className={cn(
                    "rounded-full px-3 py-1 font-semibold shadow-sm ring-1 ring-inset",
                    item.highlight
                      ? "bg-primary/15 text-primary ring-primary/30 dark:bg-primary/20 dark:text-primary-foreground"
                      : "bg-muted/30 text-muted-foreground ring-white/10",
                  )}
                >
                  {item.label}
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span
                className={cn(
                  "rounded-full px-3 py-1 font-semibold",
                  statusLabel === "Concluído"
                    ? "border border-emerald-200 bg-emerald-100 text-emerald-800 ring-1 ring-inset ring-emerald-200/80 dark:border-emerald-700/70 dark:bg-emerald-900/30 dark:text-emerald-50 dark:ring-emerald-700/60"
                    : "bg-muted font-medium text-foreground",
                )}
              >
                {statusLabel}
              </span>
              {companyLabel ? <span>Empresa: {companyLabel}</span> : null}
              <span>Última atualização: {formatDateLabel(lastUpdateAt, true)}</span>
            </div>
          </div>
          <div className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-background/60 p-4 shadow-sm">
            <div className="space-y-1">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Andamento registrado</span>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold text-foreground">{canonicalProgress.toFixed(1)}%</span>
              </div>
            </div>
            <div className="h-2 w-full rounded-full bg-muted">
              <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${clampPercent(canonicalProgress)}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(360px,460px)] xl:gap-8">
        <div className="card p-4">
          <h2 className="mb-4 text-lg font-semibold">Informações gerais</h2>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            {detailItems.map((item) => (
              <div key={item.label} className="space-y-1 rounded-xl border border-border/60 bg-muted/20 p-3 shadow-sm">
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{item.label}</dt>
                <dd
                  className={cn(
                    "text-base font-semibold text-foreground",
                    item.label === "Status" && item.value === "Concluído"
                      ? "text-emerald-700 dark:text-emerald-200"
                      : null,
                  )}
                >
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card space-y-5 p-4 lg:sticky lg:top-24 lg:h-fit lg:self-start">
          <div className="space-y-2">
            <h2 className="text-lg font-semibold">Atualização diária</h2>
            <p className="text-sm text-muted-foreground">
              Preencha o registro do dia com horários, subatividade, recursos utilizados, mão de obra e condições de trabalho
              por turno.
            </p>
          </div>

          {isServiceOpen ? (
            <ServiceUpdateForm
              serviceId={service.id}
              lastProgress={canonicalProgress}
              checklist={checklistOptions}
              onSubmit={handleUpdateSubmit}
              onUploadEvidence={uploadEvidencePhoto}
              realizedPercent={canonicalProgress}
              companyName={service.company}
              companyCnpj={service.cnpj}
            />
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
              Este serviço está {statusLabel.toLowerCase()} e não aceita novas atualizações.
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold">Checklists Recentes</h2>
            <span className="text-xs text-muted-foreground">Serviço {serviceLabel}</span>
          </div>
          {checklistItems.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhum item de checklist disponível.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {recentChecklist.map((item) => (
                <li key={item.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-foreground">{item.description}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatDateLabel(item.updatedAt, true)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>Status: {formatChecklistStatus(item.status)}</span>
                    <span className="text-sm font-semibold text-primary">{Math.round(canonicalProgress)}%</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card space-y-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Atualizações recentes</h2>
          </div>
          {recentUpdates.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Nenhuma atualização registrada.</p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {recentUpdates.slice(0, 10).map((update) => {
                const summary = buildThirdUpdateSummary(update);
                const hours = computeTimeWindowHours(update);
                return (
                  <li key={update.id} className="space-y-2 rounded-lg border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-base font-semibold text-foreground">{summary.title}</span>
                      <span className="text-sm font-semibold text-primary">{summary.percentLabel}</span>
                    </div>
                <p className="text-xs text-muted-foreground">
                  Atualizado em {formatDateLabel(update.audit?.submittedAt ?? update.submittedAt ?? update.createdAt, true)}
                </p>
                    {update.subactivity?.label ? (
                      <p className="text-xs text-muted-foreground">
                        Subatividade: <span className="font-medium text-foreground">{update.subactivity.label}</span>
                      </p>
                    ) : null}
                    {summary.description ? <p className="text-sm text-foreground">{summary.description}</p> : null}
                    {summary.resources ? (
                      <p className="text-xs text-muted-foreground">Recursos: {summary.resources}</p>
                    ) : null}
                    {summary.hoursLabel ? (
                      <p className="text-xs text-muted-foreground">{summary.hoursLabel}</p>
                    ) : null}
                    {hours === null && update.timeWindow?.start && update.timeWindow?.end ? (
                      <p className="text-xs text-muted-foreground">
                        Período: {formatDateLabel(update.timeWindow.start, true)} → {formatDateLabel(update.timeWindow.end, true)}
                      </p>
                    ) : null}
                    {update.impediments && update.impediments.length > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Impedimentos:</span>
                        <ul className="mt-1 space-y-1">
                          {update.impediments.map((item, index) => (
                            <li key={index}>
                              {item.type}
                              {item.durationHours !== null && item.durationHours !== undefined
                                ? ` • ${item.durationHours}h`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {update.workforce && update.workforce.length > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Mão de obra:</span>
                        <ul className="mt-1 space-y-1">
                          {update.workforce.map((item, index) => (
                            <li key={index}>
                              {item.role}
                              {item.quantity
                                ? ` • ${item.quantity} ${item.quantity === 1 ? "profissional" : "profissionais"}`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {update.shiftConditions && update.shiftConditions.length > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Condições por turno:</span>
                        <ul className="mt-1 space-y-1">
                          {update.shiftConditions.map((item, index) => (
                            <li key={index}>
                              {getShiftLabel(item.shift)}
                              {item.weather ? ` • ${getWeatherLabel(item.weather)}` : ""}
                              {item.condition ? ` • ${getConditionLabel(item.condition)}` : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {signatureCompanyLabel || signatureCnpjLabel ? (
                      <div className="mt-3 text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Assinatura:</span>
                        <span className="ml-1">Caixa de confirmação marcada</span>
                        <div className="mt-1 flex flex-col">
                          {signatureCompanyLabel ? <span>{signatureCompanyLabel}</span> : null}
                          {signatureCnpjLabel ? <span>CNPJ: {signatureCnpjLabel}</span> : null}
                        </div>
                      </div>
                    ) : null}
                    {update.evidences && update.evidences.length > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        <span className="font-semibold text-foreground">Evidências:</span>
                        <ul className="mt-1 space-y-1">
                          {update.evidences.map((item, index) => (
                            <li key={index}>
                              <a href={item.url} target="_blank" rel="noreferrer" className="text-primary underline">
                                {item.label || `Foto ${index + 1}`}
                              </a>
                              <img src={item.url} alt={item.label || `Foto ${index + 1}`} className="mt-1 h-24 w-full rounded border object-cover" />
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {update.justification ? (
                      <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-800">
                        Justificativa: {update.justification}
                      </div>
                    ) : null}
                    {update.criticality ? (
                      <p className="text-xs text-muted-foreground">Criticidade observada: {update.criticality}/5</p>
                    ) : null}
                    {canEditUpdates ? (
                      <div className="mt-2 flex justify-end">
                        <Link
                          href={`/servicos/${encodeURIComponent(service.id)}/editar?updateId=${update.id}&refDate=${update.timeWindow?.start ?? update.createdAt}`}
                          className="btn btn-outline btn-xs"
                        >
                          Editar
                        </Link>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
