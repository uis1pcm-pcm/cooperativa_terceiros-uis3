import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { revalidatePath, revalidateTag } from "next/cache";

import { getAdminDbOrThrow } from "@/lib/serverDb";
import { parseDayFirstDateStringToUtcDate, parsePortugueseDateStringToUtcDate } from "@/lib/dateParsing";
import { resolveCanonicalServiceStatus } from "@/lib/serviceStatus";
import { resolveServiceAssignment } from "@/lib/serviceAssignment";
import {
  buildChecklistWeightMap,
  clampPercent,
  computeProgressFromEvents,
  type ChecklistWeightInput,
  type ProgressEvent,
} from "./progressHistory";

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // Suporte a "dd/MM/yyyy" e "dd/MM/yy" (com "/" ou "-"), comum no input do usuário.
    const brDate = parseDayFirstDateStringToUtcDate(trimmed);
    if (brDate) return brDate.getTime();

    const ptDate = parsePortugueseDateStringToUtcDate(trimmed);
    if (ptDate) return ptDate.getTime();

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? null : time;
  }
  if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
    const millis = (value as { toMillis: () => number }).toMillis();
    return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    if (date && !Number.isNaN(date.getTime())) return date.getTime();
  }
  if (value && typeof (value as { seconds?: number; nanoseconds?: number }).seconds === "number") {
    const maybe = value as { seconds: number; nanoseconds?: number };
    const millis = maybe.seconds * 1000 + Math.round((maybe.nanoseconds ?? 0) / 1_000_000);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function normalisePercentFromUpdate(data: Record<string, unknown>): number | null {
  const candidates = [
    data.manualPercent,
    data.realPercentSnapshot,
    data.realPercent,
    data.percent,
    data.totalPct,
    data.progress,
    data.pct,
  ];
  for (const candidate of candidates) {
    const parsed = typeof candidate === "number" ? candidate : Number(candidate ?? NaN);
    if (Number.isFinite(parsed)) {
      return clampPercent(parsed);
    }
  }
  return null;
}

function normaliseItems(raw: unknown): Array<{ id: string; pct: number }> {
  if (!Array.isArray(raw)) return [];
  return (raw as Array<Record<string, unknown>>)
    .map((item) => {
      const idSource = item.id ?? item.itemId;
      const pctSource = item.pct;
      const id = typeof idSource === "string" ? idSource.trim() : "";
      const pct = typeof pctSource === "number" ? pctSource : Number(pctSource ?? NaN);
      if (!id || !Number.isFinite(pct)) return null;
      return { id, pct: clampPercent(pct) };
    })
    .filter(Boolean) as Array<{ id: string; pct: number }>;
}

function normaliseEvent(
  data: Record<string, unknown>,
  fallbackTimestamp: number | null,
  includeItems: boolean,
): ProgressEvent | null {
  const explicitTimestamp =
    toMillis(data.reportDate) ??
    toMillis(data.date) ??
    toMillis(data.reportDateMillis) ??
    toMillis(data.report_date) ??
    toMillis((data.timeWindow as Record<string, unknown> | undefined)?.start) ??
    null;
  const timestamp = explicitTimestamp ?? toMillis(data.createdAt) ?? fallbackTimestamp;

  if (!Number.isFinite(timestamp ?? NaN)) return null;

  const percent = normalisePercentFromUpdate(data);
  const items = includeItems ? normaliseItems(data.items) : [];
  return {
    timestamp: Number(timestamp),
    revisionTimestamp: toMillis(data.updatedAt) ?? toMillis(data.createdAt) ?? fallbackTimestamp,
    percent,
    items: items.length ? items : undefined,
    explicitDate: Number.isFinite(explicitTimestamp ?? NaN),
  };
}

export async function loadProgressHistory(
  adminDb: Firestore,
  serviceId: string,
): Promise<{
  events: ProgressEvent[];
  lastManualUpdate: { percent: number; timestamp: number } | null;
  weights: Map<string, number>;
  totalWeight: number;
  serviceData: Record<string, unknown>;
}> {
  const serviceRef = adminDb.collection("services").doc(serviceId);
  const [serviceSnap, updatesSnap, legacySnap] = await Promise.all([
    serviceRef.get(),
    serviceRef.collection("updates").orderBy("createdAt", "asc").get(),
    serviceRef.collection("serviceUpdates").orderBy("date", "asc").get(),
  ]);

  const checklistRaw = (serviceSnap.data() ?? {}) as Record<string, unknown>;
  const checklist = Array.isArray(checklistRaw.checklist)
    ? (checklistRaw.checklist as ChecklistWeightInput)
    : [];
  const { weights, totalWeight } = buildChecklistWeightMap(checklist);

  const events: ProgressEvent[] = [];
  let lastManualUpdate: { percent: number; timestamp: number } | null = null;
  updatesSnap.docs.forEach((doc) => {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const fallbackTimestamp =
      toMillis((data.audit as Record<string, unknown> | undefined)?.submittedAt) ?? toMillis(doc.createTime) ?? null;
    const event = normaliseEvent(data, fallbackTimestamp, false);
    if (event) events.push({ ...event, sourcePriority: 1 });

    const manualCandidate = typeof data.manualPercent === "number" ? data.manualPercent : Number(data.manualPercent ?? NaN);
    if (
      event &&
      typeof manualCandidate === "number" &&
      Number.isFinite(manualCandidate) &&
      (!lastManualUpdate || event.timestamp >= lastManualUpdate.timestamp)
    ) {
      lastManualUpdate = { percent: clampPercent(manualCandidate), timestamp: event.timestamp };
    }
  });

  legacySnap.docs.forEach((doc) => {
    const data = (doc.data() ?? {}) as Record<string, unknown>;
    const event = normaliseEvent(data, toMillis(doc.createTime) ?? null, true);
    if (event) events.push({ ...event, sourcePriority: 0 });
  });

  return {
    events,
    lastManualUpdate,
    weights,
    totalWeight,
    serviceData: (serviceSnap.data() ?? {}) as Record<string, unknown>,
  };
}

export async function recomputeServiceProgress(serviceId: string) {
  const adminDb = getAdminDbOrThrow();
  const { events, weights, totalWeight, serviceData } = await loadProgressHistory(adminDb, serviceId);

  const computed = computeProgressFromEvents(events, { weights, totalWeight });
  const lastTimestamp = computed.lastTimestamp;
  // `computed` já combina, em ordem cronológica, lançamentos manuais e
  // legados. Reaplicar `lastManualUpdate` aqui podia restaurar um espelho antigo
  // de 100% depois que o lançamento mais recente era corrigido para 95%.
  const currentPercent = computed.currentPercent;
  const previousProgress = [
    serviceData.previousProgress,
    serviceData.progressBeforeConclusion,
    serviceData.previousPercent,
  ]
    .map((value) => {
      if (typeof value === "number") return value;
      if (typeof value !== "string") return null;
      const parsed = Number(value.trim().replace(/%$/, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    })
    .find((value): value is number => value !== null);

  const displayStatus = resolveCanonicalServiceStatus({
    id: serviceId,
    os: String(serviceData.os ?? serviceId),
    equipmentName: String(serviceData.equipmentName ?? serviceData.equipamento ?? ""),
    plannedStart: "",
    plannedEnd: "",
    totalHours: 0,
    status: String(serviceData.status ?? "Aberto") as "Aberto" | "Pendente" | "Concluído",
    progress: currentPercent,
    previousProgress: previousProgress ?? null,
    createdAt: 0,
  });

  const payload: Record<string, unknown> = {
    andamento: currentPercent,
    realPercent: currentPercent,
    realPercentSnapshot: currentPercent,
    percent: currentPercent,
    progress: currentPercent,
    percentualRealAtual: currentPercent,
    displayStatus,
    updatedAt: lastTimestamp ? Timestamp.fromMillis(lastTimestamp) : FieldValue.serverTimestamp(),
    lastUpdateDate: lastTimestamp ? Timestamp.fromMillis(lastTimestamp) : FieldValue.serverTimestamp(),
    lastProgressUpdateAt: lastTimestamp ? Timestamp.fromMillis(lastTimestamp) : FieldValue.serverTimestamp(),
    // O valor manual antigo não pode continuar como um segundo watermark de
    // progresso; o percentual consolidado acima já foi gravado nos campos
    // canônicos e o próximo RDO deve validá-lo, não um 100% obsoleto.
    manualPercent: FieldValue.delete(),
  };

  const storedStatus = String(serviceData.status ?? "").trim().toLowerCase();
  if (currentPercent < 100 && (storedStatus === "concluído" || storedStatus === "concluido" || storedStatus === "encerrado")) {
    // Ao corrigir o último lançamento para menos de 100%, o serviço deve
    // voltar a aceitar RDOs; manter o status concluído deixaria a tela bloqueada.
    payload.status = "Pendente";
    payload.displayStatus = "Pendente";
  }

  await adminDb.collection("services").doc(serviceId).update(payload);

  const { packageId, folderId } = resolveServiceAssignment(serviceData);

  // Revalidate caches and pages that consume the service percentage so every surface refreshes immediately after an edit.
  revalidateTag("services:detail");
  // O bundle da área do terceiro usava historicamente estes tags globais.
  // Mantenha-os junto dos tags canônicos por serviço para que nenhuma tela
  // conserve o lançamento anterior após uma edição/exclusão.
  revalidateTag("services:updates");
  revalidateTag("services:legacy-updates");
  revalidateTag(`services:detail:${serviceId}`);
  revalidateTag(`services:updates:${serviceId}`);
  revalidateTag(`service:${serviceId}:updates`);
  revalidateTag(`service:${serviceId}:legacy-updates`);
  revalidateTag("services:available");
  revalidateTag("services:recent");
  revalidateTag("services:summary");
  revalidateTag("packages:detail");
  revalidateTag("packages:summary");
  revalidateTag("packages:services");
  revalidateTag("folders:detail");
  revalidateTag("folders:by-package");

  revalidatePath("/dashboard");
  revalidatePath("/servicos");
  revalidatePath("/pacotes");
  revalidatePath(`/servicos/${serviceId}`);
  revalidatePath(`/servicos/${serviceId}/editar`);
  revalidatePath(`/servicos/${serviceId}/atualizacoes`);
  revalidatePath(`/terceiro/servico/${serviceId}`);

  if (packageId) {
    revalidatePath(`/pacotes/${packageId}`);
    revalidatePath(`/pacotes/${packageId}/servicos`);
  }

  if (folderId) {
    revalidatePath(`/pacotes/pastas/${folderId}`);
    revalidatePath(`/subpacotes/${folderId}`);
  }

  return { percent: currentPercent, lastUpdate: lastTimestamp };
}

export async function computeProgressHistory(serviceId: string) {
  const adminDb = getAdminDbOrThrow();
  const { events, weights, totalWeight } = await loadProgressHistory(adminDb, serviceId);
  return computeProgressFromEvents(events, { weights, totalWeight });
}
