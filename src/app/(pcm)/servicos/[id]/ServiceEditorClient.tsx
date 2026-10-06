"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { Field, FormRow } from "@/components/ui/form-controls";
import { maskCnpjInput } from "@/lib/cnpj";
import { dateOnlyToMillis, formatDateOnlyBR, maskDateOnlyInput, parseDateOnly } from "@/lib/dateOnly";
import { tryGetFirestore } from "@/lib/firebase";
import { useFirebaseAuthSession } from "@/lib/useFirebaseAuthSession";
import { recordTelemetry } from "@/lib/telemetry";
import { resolveReopenedProgress, snapshotBeforeConclusion } from "@/lib/serviceProgress";
import { buildChecklistWeightMap, computeProgressFromEvents, type ProgressEvent } from "@/lib/progressHistory";
import { managementFetch } from "@/lib/managementFetch";

type ChecklistDraft = Array<{ id: string; descricao: string; peso: number | "" }>;

type PackageOption = { id: string; nome: string };

type UpdateHistoryItem = {
  id: string;
  date: Date | null;
  note?: string;
  totalPct?: number;
  items?: Array<{ itemId: string; pct: number }>;
  source: "updates" | "serviceUpdates";
};

function resolveDisplayStatus(status: string, progress: number, previousProgress?: number | null) {
  const raw = status.trim().toLowerCase();
  if (raw === "pendente" && Number.isFinite(previousProgress) && Number(previousProgress) < 100) {
    return "Pendente";
  }
  if (progress >= 100 || raw === "concluido" || raw === "concluído" || raw === "encerrado") {
    return "Concluído";
  }
  return raw === "pendente" ? "Pendente" : "Aberto";
}

async function invalidateServiceDashboardCache() {
  try {
    await managementFetch("/api/management/services/cache", { method: "POST" });
  } catch (error) {
    console.warn("[services] Não foi possível invalidar o cache do dashboard.", error);
  }
}

function toDateTimeLocalInput(value: Date | null): string {
  if (!value) return "";
  const timezoneOffset = value.getTimezoneOffset();
  const localDate = new Date(value.getTime() - timezoneOffset * 60 * 1000);
  // Preserve os segundos. Truncá-los ao abrir o editor podia deslocar o último
  // RDO para antes de outro lançamento do mesmo minuto durante o recálculo.
  return localDate.toISOString().slice(0, 19);
}

function parseDateTimeLocal(value: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

const STATUS_OPTIONS = ["Aberto", "Pendente", "Concluído"] as const;

function toFormStatus(value: unknown): (typeof STATUS_OPTIONS)[number] {
  const raw = String(value ?? "").toLowerCase();
  if (raw === "pendente") return "Pendente";
  if (raw === "concluido" || raw === "concluído" || raw === "encerrado") return "Concluído";
  return "Aberto";
}

function createChecklistId(seed: number) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `item-${seed}`;
}

function normaliseChecklistEntry(entry: unknown, index: number): ChecklistDraft[number] {
  const fallbackId = createChecklistId(index);
  if (!entry || typeof entry !== "object") {
    return { id: fallbackId, descricao: "", peso: 0 };
  }
  const record = entry as Record<string, unknown>;
  const idSource = record.id ?? record.itemId;
  const descricaoSource = record.descricao ?? record.description;
  const pesoSource = record.peso ?? record.weight;

  const id = typeof idSource === "string" && idSource ? idSource : fallbackId;
  const descricao = typeof descricaoSource === "string" ? descricaoSource : "";
  const pesoValue = typeof pesoSource === "number" ? pesoSource : Number(pesoSource ?? 0);

  return { id, descricao, peso: Number.isFinite(pesoValue) ? pesoValue : 0 };
}

function toDateInput(value: unknown): string {
  if (!value) return "";
  if (value instanceof Timestamp) {
    const date = value.toDate();
    if (!date || Number.isNaN(date.getTime())) return "";
    return formatDateOnlyBR({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }
  if (typeof value === "string" && value) {
    const parsed = parseDateOnly(value);
    if (parsed) {
      return formatDateOnlyBR(parsed);
    }
    const trimmed = value.trim();
    if (trimmed.length >= 10) {
      const fallback = parseDateOnly(trimmed.slice(0, 10));
      if (fallback) {
        return formatDateOnlyBR(fallback);
      }
    }
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    return formatDateOnlyBR({
      year: value.getUTCFullYear(),
      month: value.getUTCMonth() + 1,
      day: value.getUTCDate(),
    });
  }
  if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
    const date = (value as { toDate: () => Date }).toDate();
    if (!date || Number.isNaN(date.getTime())) return "";
    return formatDateOnlyBR({
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
    });
  }
  return "";
}

type ServiceEditorClientProps = {
  serviceId: string;
};

export default function ServiceEditorClient({ serviceId }: ServiceEditorClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const updateIdParam = searchParams?.get("updateId") ?? null;
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({
    os: "",
    cnpj: "",
    oc: "",
    tag: "",
    equipamento: "",
    setor: "",
    dataInicio: "",
    dataFim: "",
    horasPrevistas: "",
    empresaId: "",
    status: "Aberto" as (typeof STATUS_OPTIONS)[number],
    pacoteId: "",
  });
  const [andamento, setAndamento] = useState(0);
  const [previousProgress, setPreviousProgress] = useState<number | null>(null);
  const [withChecklist, setWithChecklist] = useState(false);
  const [checklist, setChecklist] = useState<ChecklistDraft>([]);
  const [saving, setSaving] = useState(false);
  const [packages, setPackages] = useState<PackageOption[]>([]);
  const [loadingPackages, setLoadingPackages] = useState(false);
  const [updatesLoading, setUpdatesLoading] = useState(false);
  const [updates, setUpdates] = useState<UpdateHistoryItem[]>([]);
  const [editingUpdateId, setEditingUpdateId] = useState<string | null>(null);
  const [editingUpdateSource, setEditingUpdateSource] = useState<UpdateHistoryItem["source"] | null>(null);
  const [editDateValue, setEditDateValue] = useState("");
  const [editPercentValue, setEditPercentValue] = useState("");
  const [savingUpdateEdit, setSavingUpdateEdit] = useState(false);
  const { db: firestore, error: firestoreError } = useMemo(() => tryGetFirestore(), []);
  const { ready: isAuthReady, issue: authIssue } = useFirebaseAuthSession();

  const resolveMillis = useCallback((value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value instanceof Date) {
      const time = value.getTime();
      return Number.isNaN(time) ? null : time;
    }
    if (typeof value === "string" && value.trim()) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    }
    if (value && typeof (value as { toMillis?: () => number }).toMillis === "function") {
      const millis = (value as { toMillis: () => number }).toMillis();
      return typeof millis === "number" && Number.isFinite(millis) ? millis : null;
    }
    if (value && typeof (value as { seconds?: number; nanoseconds?: number }).seconds === "number") {
      const maybe = value as { seconds: number; nanoseconds?: number };
      const millis = maybe.seconds * 1000 + Math.round((maybe.nanoseconds ?? 0) / 1_000_000);
      return Number.isFinite(millis) ? millis : null;
    }
    return null;
  }, []);

  const recomputeProgressAfterEdit = useCallback(async () => {
    try {
      const response = await fetch("/api/pcm/servicos/recompute-progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serviceId }),
      });

      if (!response.ok) {
        throw new Error(`failed_to_recompute:${response.status}`);
      }

      const json = (await response.json()) as { ok?: boolean; percent?: number };
      if (json.ok && typeof json.percent === "number" && Number.isFinite(json.percent)) {
        setAndamento(json.percent);
      }
    } catch (error) {
      console.error("[servicos/:id] Falha ao recalcular andamento após edição", error);
      toast.error("Não foi possível recalcular o andamento. Os valores podem ficar temporariamente desatualizados.");
    }
  }, [serviceId]);

  useEffect(() => {
    if (firestoreError) {
      console.error("[servicos/:id] Firestore indisponível", firestoreError);
      toast.error("Configuração de banco de dados indisponível.");
    }
  }, [firestoreError]);

  const totalPeso = useMemo(
    () =>
      checklist.reduce((acc, item) => {
        const numeric = Number(item.peso);
        if (!Number.isFinite(numeric)) return acc;
        return acc + Math.max(0, Math.min(100, numeric));
      }, 0),
    [checklist],
  );

  const refreshUpdates = useCallback(
    async (options?: { cancelledRef?: { current: boolean } }) => {
      if (!firestore || !isAuthReady) return;
      const cancelledRef = options?.cancelledRef;
      setUpdatesLoading(true);
      try {
        const ref = doc(firestore, "services", serviceId);
        const parseDate = (value: unknown): Date | null => {
          if (value instanceof Timestamp) return value.toDate();
          if (value && typeof (value as { toDate?: () => Date }).toDate === "function") {
            return (value as { toDate: () => Date }).toDate();
          }
          if (typeof value === "number" && Number.isFinite(value)) {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
          }
          if (typeof value === "string" && value.trim()) {
            const parsed = new Date(value);
            return Number.isNaN(parsed.getTime()) ? null : parsed;
          }
          return null;
        };

        const mapUpdate = (
          docSnap: Awaited<ReturnType<typeof getDocs>>["docs"][number],
          source: UpdateHistoryItem["source"],
        ): UpdateHistoryItem => {
          const data = docSnap.data() ?? {};
          const dateSource = data.date ?? data.reportDate ?? data.createdAt ?? (docSnap.metadata.hasPendingWrites ? null : docSnap.createTime);
          const date = parseDate(dateSource);

          const rawPercent =
            typeof data.realPercentSnapshot === "number"
              ? data.realPercentSnapshot
              : typeof data.manualPercent === "number"
                ? data.manualPercent
                : typeof data.percent === "number"
                  ? data.percent
                  : typeof data.totalPct === "number"
                    ? data.totalPct
                    : undefined;

          return {
            id: docSnap.id,
            date,
            note: typeof data.note === "string" ? data.note : typeof data.description === "string" ? data.description : undefined,
            totalPct: typeof rawPercent === "number" ? rawPercent : undefined,
            items: Array.isArray(data.items) ? data.items : undefined,
            source,
          };
        };

        const [newUpdatesSnap, legacyUpdatesSnap] = await Promise.all([
          getDocs(query(collection(ref, "updates"), orderBy("createdAt", "desc"), limit(50))),
          getDocs(query(collection(ref, "serviceUpdates"), orderBy("date", "desc"), limit(50))),
        ]);

        const mapped: UpdateHistoryItem[] = [
          ...newUpdatesSnap.docs.map((docSnap) => mapUpdate(docSnap, "updates")),
          ...legacyUpdatesSnap.docs.map((docSnap) => mapUpdate(docSnap, "serviceUpdates")),
        ].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));

        const filtered = mapped.filter((item) => {
          if (item.source !== "updates") return true;
          const hasNote = typeof item.note === "string" && item.note.trim().length > 0;
          const hasItems = Array.isArray(item.items) && item.items.length > 0;
          return hasNote || hasItems;
        });

        if (!cancelledRef?.current) setUpdates(filtered);
      } catch (error) {
        console.error("[servicos/:id] Falha ao carregar histórico", error);
        if (!cancelledRef?.current) toast.error("Não foi possível carregar o histórico de atualizações.");
      } finally {
        if (!cancelledRef?.current) setUpdatesLoading(false);
      }
    },
    [firestore, isAuthReady, serviceId],
  );

  useEffect(() => {
    if (!firestore || !isAuthReady) return;
    setLoadingPackages(true);
    getDocs(query(collection(firestore, "packages"), orderBy("nome", "asc")))
      .then((snapshot) => {
        const result: PackageOption[] = snapshot.docs.map((docSnap) => {
          const data = docSnap.data() ?? {};
          return { id: docSnap.id, nome: String(data.nome ?? data.name ?? "") };
        });
        setPackages(result);
      })
      .catch((error) => {
        console.error("[servicos/:id] Falha ao carregar pacotes", error);
        const errorCode =
          typeof error === "object" && error !== null && "code" in error && typeof (error as { code?: unknown }).code === "string"
            ? ((error as { code: string }).code)
            : null;
        if (errorCode === "permission-denied") {
          toast.error("Você não tem permissão para ver os pacotes disponíveis.");
        } else {
          toast.error("Não foi possível carregar os pacotes disponíveis.");
        }
      })
      .finally(() => setLoadingPackages(false));
  }, [firestore, isAuthReady]);

  useEffect(() => {
    if (!firestore || !isAuthReady) return;
    const cancelledRef = { current: false };
    refreshUpdates({ cancelledRef }).catch((error) => {
      console.error("[servicos/:id] Falha ao carregar histórico", error);
    });

    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const ref = doc(firestore, "services", serviceId);
        const snap = await getDoc(ref);
        if (!snap.exists()) {
          toast.error("Serviço não encontrado.");
          return;
        }
        if (cancelled) return;

        const data = snap.data() ?? {};
        const rawCnpj = typeof data.cnpj === "string" ? data.cnpj : "";
        setForm({
          os: String(data.os ?? ""),
          cnpj: rawCnpj ? maskCnpjInput(rawCnpj) : "",
          oc: String(data.oc ?? ""),
          tag: String(data.tag ?? ""),
          equipamento: String(data.equipamento ?? data.equipmentName ?? ""),
          setor: String(data.setor ?? ""),
          dataInicio: toDateInput(data.inicioPrevisto),
          dataFim: toDateInput(data.fimPrevisto),
          horasPrevistas: data.horasPrevistas ? String(data.horasPrevistas) : "",
          empresaId: String(data.empresaId ?? data.company ?? ""),
          status: toFormStatus(data.status),
          pacoteId: String(data.pacoteId ?? data.packageId ?? ""),
        });
        const checklistData = Array.isArray(data.checklist) ? data.checklist : [];
        setChecklist(checklistData.map((item, index) => normaliseChecklistEntry(item, index)));
        setWithChecklist(checklistData.length > 0);
        // Priorizar realPercentSnapshot (valor mais recente lançado pelo terceiro)
        const resolvedProgress = Number(
          data.realPercentSnapshot ??
          data.manualPercent ??
          data.realPercent ??
          data.andamento ??
          0
        );
        setAndamento(resolvedProgress);
        const prevProgressValue = Number(data.previousProgress ?? data.progressBeforeConclusion ?? data.previousPercent ?? NaN);
        setPreviousProgress(Number.isFinite(prevProgressValue) ? prevProgressValue : null);
        await refreshUpdates({ cancelledRef: { current: cancelled } });
      } catch (error) {
        console.error("[servicos/:id] Falha ao carregar serviço", error);
        toast.error("Não foi possível carregar os dados do serviço.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();

    return () => {
      cancelled = true;
      cancelledRef.current = true;
    };
  }, [firestore, isAuthReady, refreshUpdates, serviceId]);

  const startEditingUpdate = useCallback((update: UpdateHistoryItem) => {
    setEditingUpdateId(update.id);
    setEditingUpdateSource(update.source);
    setEditDateValue(toDateTimeLocalInput(update.date));
    setEditPercentValue(
      typeof update.totalPct === "number" && Number.isFinite(update.totalPct) ? String(update.totalPct) : "",
    );
  }, []);

  useEffect(() => {
    if (!updateIdParam) return;
    const target = updates.find((u) => u.id === updateIdParam);
    if (target) startEditingUpdate(target);
  }, [updateIdParam, updates, startEditingUpdate]);

  const cancelEditingUpdate = useCallback(() => {
    setEditingUpdateId(null);
    setEditingUpdateSource(null);
    setEditDateValue("");
    setEditPercentValue("");
    setSavingUpdateEdit(false);
  }, []);

  const saveEditingUpdate = useCallback(async () => {
    if (!firestore || !isAuthReady || !editingUpdateId || !editingUpdateSource) return;

    const parsedDate = parseDateTimeLocal(editDateValue);
    if (!parsedDate) {
      toast.error("Informe uma data e hora válidas.");
      return;
    }

    const parsedPercent = Number(editPercentValue);
    if (!Number.isFinite(parsedPercent)) {
      toast.error("Informe um percentual válido entre 0 e 100.");
      return;
    }
    const clampedPercent = Math.max(0, Math.min(100, parsedPercent));

    setSavingUpdateEdit(true);
    try {
      const response = await managementFetch("/api/pcm/servicos/update-progress-entry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          updateId: editingUpdateId,
          source: editingUpdateSource,
          date: parsedDate.toISOString(),
          percent: clampedPercent,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; percent?: number };
      if (!response.ok || !result.ok) throw new Error(`failed_to_update_progress_entry:${response.status}`);

      await invalidateServiceDashboardCache();
      if (typeof result.percent === "number") setAndamento(result.percent);
      
      toast.success("Lançamento atualizado com sucesso.");
      await refreshUpdates();
      router.refresh();
      cancelEditingUpdate();
    } catch (error) {
      console.error("[servicos/:id] Falha ao alterar lançamento do terceiro", error);
      toast.error("Não foi possível alterar o lançamento.");
    } finally {
      setSavingUpdateEdit(false);
    }
  }, [
    cancelEditingUpdate,
    editDateValue,
    editPercentValue,
    editingUpdateId,
    firestore,
    isAuthReady,
    refreshUpdates,
    router,
    serviceId,
  ]);

  const deleteEditingUpdate = useCallback(async () => {
    if (!firestore || !isAuthReady || !editingUpdateId || !editingUpdateSource) return;
    if (!window.confirm("Tem certeza que deseja excluir este lançamento? Essa ação não pode ser desfeita.")) return;

    setSavingUpdateEdit(true);
    try {
      const response = await managementFetch("/api/pcm/servicos/update-progress-entry", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serviceId,
          updateId: editingUpdateId,
          source: editingUpdateSource,
        }),
      });
      const result = (await response.json()) as { ok?: boolean; percent?: number; error?: string };
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? `failed_to_delete_progress_entry:${response.status}`);
      }

      await invalidateServiceDashboardCache();
      if (typeof result.percent === "number") setAndamento(result.percent);

      toast.success("Lançamento excluído com sucesso.");
      cancelEditingUpdate();
      await refreshUpdates();
      if (updateIdParam) router.replace(`/servicos/${encodeURIComponent(serviceId)}/editar`);
      router.refresh();
    } catch (error) {
      console.error("[servicos/:id] Falha ao excluir lançamento", error);
      toast.error("Não foi possível excluir o lançamento.");
    } finally {
      setSavingUpdateEdit(false);
    }
  }, [
    cancelEditingUpdate,
    editingUpdateId,
    editingUpdateSource,
    firestore,
    isAuthReady,
    refreshUpdates,
    router,
    serviceId,
    updateIdParam,
  ]);

  function updateForm<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateChecklistItem(id: string, patch: Partial<ChecklistDraft[number]>) {
    setChecklist((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeChecklistItem(id: string) {
    setChecklist((prev) => prev.filter((item) => item.id !== id));
  }

  function addChecklistItem() {
    const id = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2, 11);
    setChecklist((prev) => [...prev, { id, descricao: "", peso: "" }]);
    setWithChecklist(true);
  }

  async function saveChanges() {
    if (!form.os.trim() || !form.tag.trim() || !form.equipamento.trim()) {
      toast.error("Preencha os campos obrigatórios (O.S, Tag e Equipamento).");
      return;
    }
    const inicioPrevisto = parseDateOnly(form.dataInicio);
    const fimPrevisto = parseDateOnly(form.dataFim);
    if (!inicioPrevisto || !fimPrevisto) {
      toast.error("Datas inválidas. Utilize o formato dd/mm/aaaa.");
      return;
    }
    const inicioMillis = dateOnlyToMillis(inicioPrevisto);
    const fimMillis = dateOnlyToMillis(fimPrevisto);
    if (inicioMillis > fimMillis) {
      toast.error("A data de término prevista deve ser posterior ou igual à data de início.");
      return;
    }
    const horas = Number(form.horasPrevistas);
    if (!Number.isFinite(horas) || horas <= 0) {
      toast.error("Horas previstas deve ser um número maior que zero.");
      return;
    }
    if (withChecklist && checklist.length > 0 && Math.round(totalPeso) !== 100) {
      toast.error("A soma dos pesos do checklist deve ser 100%.");
      return;
    }

    if (!firestore) {
      toast.error("Banco de dados indisponível.");
      return;
    }
    if (!isAuthReady) {
      toast.error("Sua sessão segura ainda não foi confirmada. Aguarde ou faça login novamente.");
      return;
    }

    setSaving(true);
    try {
      const ref = doc(firestore, "services", serviceId);
      const payload = {
        os: form.os.trim(),
        oc: form.oc.trim() || null,
        tag: form.tag.trim(),
        equipamento: form.equipamento.trim(),
        equipmentName: form.equipamento.trim(),
        setor: form.setor.trim() || null,
        inicioPrevisto: Timestamp.fromMillis(inicioMillis),
        fimPrevisto: Timestamp.fromMillis(fimMillis),
        horasPrevistas: horas,
        empresaId: form.empresaId.trim() || null,
        company: form.empresaId.trim() || null,
        cnpj: form.cnpj.trim() || null,
        status: form.status,
        displayStatus: resolveDisplayStatus(form.status, andamento, previousProgress),
        pacoteId: form.pacoteId || null,
        packageId: form.pacoteId || null,
        checklist: withChecklist
          ? checklist.map((item) => ({
              id: item.id,
              descricao: item.descricao.trim(),
              peso: Math.max(0, Math.min(100, Number(item.peso) || 0)),
            }))
          : [],
        updatedAt: serverTimestamp(),
      };
      await updateDoc(ref, payload);
      await invalidateServiceDashboardCache();
      await recomputeProgressAfterEdit();
      toast.success("Serviço atualizado com sucesso.");
      router.push(`/servicos/${encodeURIComponent(serviceId)}`);
    } catch (error) {
      console.error("[servicos/:id] Falha ao salvar", error);
      toast.error("Não foi possível salvar as alterações.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(status: (typeof STATUS_OPTIONS)[number], progresso?: number) {
    if (!firestore) {
      toast.error("Banco de dados indisponível.");
      return;
    }
    if (!isAuthReady) {
      toast.error("Sua sessão segura ainda não foi confirmada. Aguarde ou faça login novamente.");
      return;
    }
    setSaving(true);
    try {
      const ref = doc(firestore, "services", serviceId);
      const payload: Record<string, unknown> = {
        status,
        updatedAt: serverTimestamp(),
      };
      let nextProgress: number | null = null;
      const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
      const currentProgress = Number.isFinite(andamento) ? clamp(andamento) : 0;

      if (status === "Concluído") {
        const snapshot = snapshotBeforeConclusion(currentProgress, previousProgress);
        payload.previousProgress = snapshot;
        payload.andamento = 100;
        nextProgress = 100;
        setPreviousProgress(snapshot);
        recordTelemetry("service.progress.snapshot", { serviceId, progress: snapshot });
      } else if (status === "Pendente") {
        const history = updates
          .map((item) => (typeof item.totalPct === "number" ? item.totalPct : null))
          .filter((value): value is number => Number.isFinite(value ?? NaN));
        const target = resolveReopenedProgress({
          requested: typeof progresso === "number" ? progresso : null,
          previousStored: previousProgress,
          history,
          current: andamento,
        });
        payload.andamento = target;
        payload.previousProgress = target;
        nextProgress = target;
        setPreviousProgress(target);
        recordTelemetry("service.progress.restore", { serviceId, restored: target });
      } else if (typeof progresso === "number" && Number.isFinite(progresso)) {
        payload.andamento = clamp(progresso);
        nextProgress = clamp(progresso);
      }

      payload.displayStatus = resolveDisplayStatus(
        status,
        nextProgress ?? currentProgress,
        typeof payload.previousProgress === "number" ? payload.previousProgress : previousProgress,
      );

      // Mantenha todos os campos consumidos pelas telas públicas sincronizados.
      // Documentos antigos podem conter `progress`/`realPercent` e, se apenas
      // `andamento` mudar, a listagem do subpacote acaba exibindo o valor antigo.
      if (nextProgress !== null) {
        payload.progress = nextProgress;
        payload.realPercent = nextProgress;
        payload.realPercentSnapshot = nextProgress;
        payload.percent = nextProgress;
        payload.percentualRealAtual = nextProgress;
        payload.lastProgressUpdateAt = serverTimestamp();
        payload.lastUpdateDate = serverTimestamp();
      }

      await updateDoc(ref, payload);
      await invalidateServiceDashboardCache();
      setForm((prev) => ({ ...prev, status }));
      if (nextProgress !== null) {
        setAndamento(nextProgress);
      }
      toast.success("Status atualizado.");
    } catch (error) {
      console.error("[servicos/:id] Falha ao alterar status", error);
      toast.error("Não foi possível alterar o status.");
    } finally {
      setSaving(false);
    }
  }

  if (!isAuthReady) {
    return (
      <div className="grid gap-6">
        <div className="rounded-2xl border bg-amber-50 p-6 text-sm text-amber-700 shadow-sm">
          {authIssue ?? "Sincronizando sessão segura. Aguarde..."}
        </div>
      </div>
    );
  }

  if (!firestore) {
    return (
      <div className="grid gap-6">
        <div className="rounded-2xl border bg-card/80 p-6 text-sm text-amber-600 shadow-sm">
          Não foi possível carregar o banco de dados. Verifique a configuração do Firebase.
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6">
      <div className="rounded-2xl border bg-card/80 p-6 shadow-sm">
        {loading ? (
          <div className="space-y-4">
            <div className="h-6 w-3/4 animate-pulse rounded bg-muted/50" />
            <div className="h-40 animate-pulse rounded bg-muted/40" />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold">Dados gerais</h2>
                <p className="text-sm text-muted-foreground">
                  Atualize os campos do serviço e gerencie o checklist utilizado nas medições.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                <div className="rounded-lg border border-primary/40 bg-primary/5 px-4 py-2 text-sm">
                  Andamento atual: <span className="font-semibold text-primary">{Math.round(andamento)}%</span>
                </div>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={saveChanges}
                  disabled={saving}
                  aria-busy={saving}
                >
                  {saving ? "Salvando..." : "Salvar edição"}
                </button>
              </div>
            </div>

            <FormRow>
              <div className="flex w-full flex-col gap-3">
                <Field label="O.S" value={form.os} onChange={(event) => updateForm("os", event.target.value)} required />
                <Field
                  label="CNPJ"
                  value={form.cnpj}
                  onChange={(event) => updateForm("cnpj", maskCnpjInput(event.target.value))}
                  placeholder="00.000.000/0000-00"
                  inputMode="numeric"
                  maxLength={18}
                />
              </div>
              <Field label="O.C" value={form.oc} onChange={(event) => updateForm("oc", event.target.value)} />
            </FormRow>
            <FormRow>
              <Field label="Tag" value={form.tag} onChange={(event) => updateForm("tag", event.target.value)} required />
              <Field
                label="Equipamento"
                value={form.equipamento}
                onChange={(event) => updateForm("equipamento", event.target.value)}
                required
              />
            </FormRow>
            <FormRow>
              <Field label="Setor" value={form.setor} onChange={(event) => updateForm("setor", event.target.value)} />
              <Field
                label="Empresa"
                value={form.empresaId}
                onChange={(event) => updateForm("empresaId", event.target.value)}
              />
            </FormRow>
            <FormRow>
              <Field
                label="Data de início prevista"
                value={form.dataInicio}
                onChange={(event) => updateForm("dataInicio", maskDateOnlyInput(event.target.value))}
                onBlur={(event) => updateForm("dataInicio", maskDateOnlyInput(event.target.value))}
                placeholder="dd/mm/aaaa"
                inputMode="numeric"
                maxLength={10}
                pattern="\d{2}/\d{2}/\d{4}"
                required
              />
              <Field
                label="Data de término prevista"
                value={form.dataFim}
                onChange={(event) => updateForm("dataFim", maskDateOnlyInput(event.target.value))}
                onBlur={(event) => updateForm("dataFim", maskDateOnlyInput(event.target.value))}
                placeholder="dd/mm/aaaa"
                inputMode="numeric"
                maxLength={10}
                pattern="\d{2}/\d{2}/\d{4}"
                required
              />
            </FormRow>
            <FormRow>
              <Field
                label="Horas previstas"
                type="number"
                min={0}
                step="0.5"
                value={form.horasPrevistas}
                onChange={(event) => updateForm("horasPrevistas", event.target.value)}
                required
              />
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground/90" htmlFor="status">
                  Status
                </label>
                <select
                  id="status"
                  value={form.status}
                  onChange={(event) => updateForm("status", event.target.value as (typeof STATUS_OPTIONS)[number])}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </FormRow>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground/90" htmlFor="pacote">
                Pacote
              </label>
              <select
                id="pacote"
                value={form.pacoteId}
                onChange={(event) => updateForm("pacoteId", event.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
                disabled={loadingPackages}
              >
                <option value="">Nenhum pacote</option>
                {packages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.nome || `Pacote ${pkg.id}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-dashed bg-muted/20 p-4">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground/90">
                <input
                  type="checkbox"
                  checked={withChecklist}
                  onChange={(event) => setWithChecklist(event.target.checked)}
                  className="h-4 w-4 rounded border-border"
                />
                Utilizar checklist para este serviço
              </label>

              {withChecklist ? (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-muted-foreground">Itens do checklist</span>
                    <button type="button" onClick={addChecklistItem} className="btn btn-secondary text-xs">
                      Adicionar item
                    </button>
                  </div>
                  {checklist.length === 0 ? (
                    <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                      Nenhum item cadastrado.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {checklist.map((item) => (
                        <div key={item.id} className="rounded-lg border bg-background p-4 shadow-sm">
                          <div className="flex flex-col gap-3 sm:flex-row">
                            <div className="flex-1">
                              <label
                                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                htmlFor={`desc-${item.id}`}
                              >
                                Descrição
                              </label>
                              <textarea
                                id={`desc-${item.id}`}
                                value={item.descricao}
                                onChange={(event) => updateChecklistItem(item.id, { descricao: event.target.value })}
                                rows={2}
                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
                              />
                            </div>
                            <div className="w-full sm:w-40">
                              <label
                                className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                                htmlFor={`peso-${item.id}`}
                              >
                                Peso (%)
                              </label>
                              <input
                                id={`peso-${item.id}`}
                                type="number"
                                min={0}
                                max={100}
                                step="0.5"
                                value={item.peso === "" ? "" : item.peso}
                                onChange={(event) => {
                                  const raw = event.target.value;
                                  if (raw === "") {
                                    updateChecklistItem(item.id, { peso: "" });
                                    return;
                                  }
                                  const parsed = Number(raw);
                                  if (!Number.isFinite(parsed)) return;
                                  const clamped = Math.max(0, Math.min(100, parsed));
                                  updateChecklistItem(item.id, { peso: clamped });
                                }}
                                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
                              />
                            </div>
                          </div>
                          <div className="mt-3 text-right">
                            <button
                              type="button"
                              onClick={() => removeChecklistItem(item.id)}
                              className="text-xs font-medium text-destructive hover:underline"
                            >
                              Remover item
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-lg border bg-background/60 p-3 text-sm">
                    <div className="flex items-center justify-between font-medium">
                      <span>Soma dos pesos</span>
                      <span className={Math.round(totalPeso) === 100 ? "text-primary" : "text-amber-600"}>
                        {totalPeso.toFixed(1)}%
                      </span>
                    </div>
                    {Math.round(totalPeso) !== 100 ? (
                      <p className="mt-1 text-xs text-amber-600">A soma precisa atingir 100%.</p>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={saveChanges}
                disabled={saving}
                aria-busy={saving}
              >
                {saving ? "Salvando..." : "Salvar alterações"}
              </button>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => changeStatus("Concluído", 100)}
                  disabled={saving}
                >
                  Concluir serviço
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => changeStatus("Pendente")}
                  disabled={saving}
                >
                  Marcar como pendente
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border bg-card/80 p-6 shadow-sm">
        <h2 className="text-xl font-semibold">Histórico de atualizações</h2>
        {updatesLoading ? (
          <div className="mt-4 space-y-2">
            <div className="h-4 w-full animate-pulse rounded bg-muted/40" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted/40" />
          </div>
        ) : updates.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">Nenhuma atualização registrada até o momento.</p>
        ) : (
          <ul className="mt-4 space-y-4">
            {updates.map((update) => (
              <li key={update.id} className="rounded-lg border bg-background p-4 shadow-sm">
                <div className="flex flex-col gap-1 text-sm">
                  <span className="font-semibold text-foreground">
                    {update.date
                      ? update.date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
                      : "Data não informada"}
                  </span>
                  {typeof update.totalPct === "number" ? (
                    <span className="text-xs text-muted-foreground">Percentual total: {Math.round(update.totalPct)}%</span>
                  ) : null}
                  {Array.isArray(update.items) && update.items.length > 0 ? (
                    <div className="text-xs text-muted-foreground">
                      Itens: {update.items.map((item) => `${item.itemId}: ${Math.round(item.pct)}%`).join(", ")}
                    </div>
                  ) : null}
                  {update.note ? <p className="text-sm text-muted-foreground">{update.note}</p> : null}
                </div>
                {updateIdParam && update.id !== updateIdParam ? null : editingUpdateId === update.id ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Data e hora do lançamento
                        </label>
                        <input
                          type="datetime-local"
                          step={1}
                          value={editDateValue}
                          onChange={(event) => setEditDateValue(event.target.value)}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          Percentual total (%)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step="0.5"
                          value={editPercentValue}
                          onChange={(event) => setEditPercentValue(event.target.value)}
                          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40"
                        />
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={saveEditingUpdate}
                        disabled={savingUpdateEdit}
                      >
                        {savingUpdateEdit ? "Salvando..." : "Salvar alterações"}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={cancelEditingUpdate}
                        disabled={savingUpdateEdit}
                      >
                        Cancelar
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={deleteEditingUpdate}
                        disabled={savingUpdateEdit}
                      >
                        {savingUpdateEdit ? "Aguarde..." : "Excluir lançamento"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      className="btn btn-outline btn-sm"
                      onClick={() => startEditingUpdate(update)}
                    >
                      Alterar lançamento
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
