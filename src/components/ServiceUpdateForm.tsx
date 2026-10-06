"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFieldArray, useForm } from "react-hook-form";
import { Check, ImagePlus, X } from "lucide-react";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";

import { useRouter } from "next/navigation";
import { normalizeCnpj } from "@/lib/cnpj";
import { cn } from "@/lib/utils";

export type ServiceUpdateFormPayload = {
  percent: number;
  description: string;
  start: string;
  end: string;
  date: string;
  reportDate: number | null;
  subactivities: Array<{ id: string; label: string; progress?: number }>;
  resources: Array<{ name: string }>;
  workforce: Array<{ role: string; quantity: number }>;
  shiftConditions: Array<{
    shift: "manha" | "tarde" | "noite";
    weather: "claro" | "nublado" | "chuvoso";
    condition: "praticavel" | "impraticavel";
  }>;
  declarationAccepted: true;
  evidences: Array<{ url: string; label?: string }>;
};
type PendingEvidence = { file: File; previewUrl: string; label?: string };

type ChecklistOption = { id: string; description: string; progress?: number; weight?: number };

type ServiceUpdateFormProps = {
  serviceId: string;
  lastProgress: number;
  checklist: ChecklistOption[];
  onSubmit: (payload: ServiceUpdateFormPayload) => Promise<void> | void;
  onUploadEvidence?: (file: File) => Promise<{ url: string; label?: string }>;
  realizedPercent?: number;
  companyName?: string | null;
  companyCnpj?: string | null;
};

const RESOURCE_OPTIONS = [
  { id: "andaimes", label: "Andaimes" },
  { id: "chave-impacto", label: "Chave de impacto" },
  { id: "parafusadeiras", label: "Parafusadeiras" },
  { id: "maquina-solda", label: "Máquina de solda" },
  { id: "lixadeiras", label: "Lixadeiras" },
  { id: "serra-makita", label: "Serra tipo Makita" },
  { id: "escada", label: "Escada" },
  { id: "extensao", label: "Extensão" },
  { id: "jogo-chaves", label: "Jogo de chaves" },
  { id: "furadeira", label: "Furadeira" },
  { id: "saca-rolamento", label: "Saca-rolamento" },
  { id: "talha", label: "Talha" },
  { id: "retifica", label: "Retífica" },
  { id: "cinto-seguranca", label: "Cinto de segurança" },
  { id: "plasma", label: "Plasma" },
];

const WORKFORCE_ROLES = [
  "Montador",
  "Caldeireiro",
  "Soldador",
  "Mecânico",
  "Ajudante",
  "Auxiliar",
  "Pedreiro",
  "Encarregado",
  "Engenheiro",
  "Eletricista",
  "Operador",
  "Motorista",
];

const SHIFT_OPTIONS = [
  { id: "manha" as const, label: "Manhã" },
  { id: "tarde" as const, label: "Tarde" },
  { id: "noite" as const, label: "Noite" },
];

const WEATHER_OPTIONS = [
  { id: "claro" as const, label: "Claro" },
  { id: "nublado" as const, label: "Nublado" },
  { id: "chuvoso" as const, label: "Chuvoso" },
];

const CONDITION_OPTIONS = [
  { id: "praticavel" as const, label: "Praticável" },
  { id: "impraticavel" as const, label: "Impraticável" },
];

function parseDateOnly(value: string): Date | null {
  if (!value || typeof value !== "string") return null;
  const match = /^\d{4}-\d{2}-\d{2}$/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = value.split("-").map((part) => Number(part));
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function toDateRangeIso(value: string): { start: string; end: string } | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
  return { start: start.toISOString(), end: end.toISOString() };
}

function clampPercentValue(value: number): number {
  if (!Number.isFinite(value)) return 0;
  // Preservar o valor exato digitado pelo terceiro, apenas garantir que está no range válido
  // Removido Math.round para evitar alterar valores como 20 para 18
  return Math.min(100, Math.max(0, value));
}

function computeChecklistPercent(
  checklist: ChecklistOption[],
  subactivities: Array<{ progress?: number } | undefined> | undefined,
  fallback: number,
): number {
  if (!Array.isArray(checklist) || checklist.length === 0) {
    // Preservar valor exato do fallback
    return Math.min(100, Math.max(0, fallback));
  }

  let weightedSum = 0;
  let totalWeight = 0;

  checklist.forEach((item, index) => {
    const baseProgress = (() => {
      const submitted = subactivities?.[index]?.progress;
      if (typeof submitted === "number" && Number.isFinite(submitted)) {
        return submitted;
      }
      if (typeof item.progress === "number" && Number.isFinite(item.progress)) {
        return item.progress;
      }
      return null;
    })();

    if (baseProgress === null) {
      return;
    }

    const weightValue =
      typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0
        ? item.weight
        : 1;

    weightedSum += weightValue * baseProgress;
    totalWeight += weightValue;
  });

  if (totalWeight === 0) {
    return Math.min(100, Math.max(0, fallback));
  }

  const computed = weightedSum / totalWeight;
  if (!Number.isFinite(computed)) {
    return Math.min(100, Math.max(0, fallback));
  }

  // Preservar valor calculado exato, apenas garantir que está no range válido
  return Math.min(100, Math.max(0, computed));
}

function extractFieldErrorMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (!("message" in value)) return null;
  const record = value as { message?: unknown };
  return typeof record.message === "string" ? record.message : null;
}

const workforceItemSchema = z.object({
  role: z.string().min(1, "Selecione a função"),
  quantity: z
    .coerce
    .number({ invalid_type_error: "Informe a quantidade" })
    .min(1, "Quantidade mínima 1")
    .max(999, "Quantidade inválida"),
});

const shiftDetailSchema = z.object({
  shift: z.enum(["manha", "tarde", "noite"]),
  weather: z.enum(["claro", "nublado", "chuvoso"]),
  condition: z.enum(["praticavel", "impraticavel"]),
});

const subactivitySchema = z.object({
  id: z.string(),
  progress: z
    .number({ invalid_type_error: "Informe o percentual da subatividade" })
    .min(0, "Mínimo 0%")
    .max(100, "Máximo 100%")
    .optional(),
});

const formSchema = z
  .object({
    date: z.string().min(1, "Data obrigatória"),
    description: z.string().min(1, "Descreva o que foi realizado"),
    declarationAccepted: z.literal(true, {
      errorMap: () => ({ message: "É necessário aceitar a declaração" }),
    }),
    resources: z.array(z.string()).default([]),
    workforce: z.array(workforceItemSchema).min(1, "Informe ao menos uma função"),
    shifts: z
      .array(shiftDetailSchema)
      .min(1, "Selecione ao menos um turno")
      .max(3, "Selecione até três turnos"),
    subactivities: z.array(subactivitySchema).default([]),
  })
  .superRefine((values, ctx) => {
    if (!parseDateOnly(values.date)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["date"],
        message: "Data inválida",
      });
    }
    const uniqueShifts = new Set(values.shifts.map((item) => item.shift));
    if (uniqueShifts.size !== values.shifts.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["shifts"],
        message: "Cada turno deve ser informado apenas uma vez",
      });
    }
    // Validar que se há checklist, pelo menos um item deve ter progresso
    if (values.subactivities.length > 0) {
      const hasProgress = values.subactivities.some((item) => typeof item.progress === "number" && Number.isFinite(item.progress));
      if (!hasProgress) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["subactivities"],
          message: "Informe o progresso de pelo menos uma subatividade",
        });
      }
    }
  });

type FormValues = z.infer<typeof formSchema>;

export default function ServiceUpdateForm({
  serviceId,
  lastProgress,
  checklist,
  onSubmit,
  onUploadEvidence,
  realizedPercent,
  companyName,
  companyCnpj,
}: ServiceUpdateFormProps) {
  const safeChecklist = useMemo(
    () => (Array.isArray(checklist) ? checklist : []),
    [checklist],
  );
  const [pendingEvidences, setPendingEvidences] = useState<PendingEvidence[]>([]);
  const [uploadingEvidence, setUploadingEvidence] = useState(false);
  const [evidenceUploadError, setEvidenceUploadError] = useState<string | null>(null);
  const evidenceInputRef = useRef<HTMLInputElement | null>(null);
  const router = useRouter();
  const handleBack = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push("/terceiro");
    }
  }, [router]);

  const checklistDefaults = useMemo(
    () =>
      safeChecklist.map((item) => ({
        id: item.id,
        progress: undefined,
      })),
    [safeChecklist],
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      date: "",
      description: "",
      resources: [],
      workforce: [{ role: "", quantity: 1 }],
      shifts: [],
      declarationAccepted: false,
      subactivities: checklistDefaults,
    },
  });

  const {
    register,
    control,
    watch,
    handleSubmit,
    setValue,
    reset,
    formState: { errors, isSubmitting },
  } = form;

  const workforceArray = useFieldArray({ control, name: "workforce" });
  const shiftArray = useFieldArray({ control, name: "shifts" });

  const selectedResources = watch("resources");
  const subactivityValues = watch("subactivities");
  const declarationCompany = companyName?.trim() || null;
  const declarationCnpjValue = companyCnpj ? normalizeCnpj(companyCnpj).trim() : "";
  const declarationCnpj = declarationCnpjValue.length > 0 ? declarationCnpjValue : null;
  const declarationText = `Declaro em nome da empresa ${
    declarationCompany ?? "atribuída a este serviço"
  }, CNPJ ${
    declarationCnpj ?? "informado no cadastro"
  }, que as informações fornecidas são verdadeiras e assumo a responsabilidade pelas atualizações realizadas neste serviço.`;

  const computedPercent = useMemo(
    () => {
      const normalizedLastProgress = clampPercentValue(lastProgress);
      return computeChecklistPercent(safeChecklist, subactivityValues, normalizedLastProgress);
    },
    [safeChecklist, subactivityValues, lastProgress],
  );

  useEffect(() => {
    setValue("subactivities", checklistDefaults, { shouldDirty: false });
  }, [checklistDefaults, setValue]);

  const selectedShifts = useMemo(() => shiftArray.fields.map((item) => item.shift), [shiftArray.fields]);

  function toggleResource(resourceId: string) {
    const current = new Set(selectedResources ?? []);
    if (current.has(resourceId)) {
      current.delete(resourceId);
    } else {
      current.add(resourceId);
    }
    setValue("resources", Array.from(current), { shouldDirty: true });
  }

  function toggleShift(shiftId: "manha" | "tarde" | "noite") {
    const index = shiftArray.fields.findIndex((item) => item.shift === shiftId);
    if (index >= 0) {
      shiftArray.remove(index);
      return;
    }
    if (shiftArray.fields.length >= 3) {
      return;
    }
    shiftArray.append({ shift: shiftId, weather: "claro", condition: "praticavel" });
  }

  async function submit(values: FormValues, evidences: Array<{ url: string; label?: string }>) {
    const range = toDateRangeIso(values.date);
    if (!range) {
      form.setError("date", { type: "custom", message: "Data inválida" });
      return;
    }

    const reportDate = (() => {
      if (!values.date) return null;
      const parsed = new Date(`${values.date}T12:00:00Z`);
      return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
    })();

    const subactivityUpdates = values.subactivities
      .map((item, index) => {
        const meta = safeChecklist[index];
        if (!meta) return null;
        const progress = typeof item?.progress === "number" && Number.isFinite(item.progress)
          ? Math.max(0, Math.min(100, Math.round(item.progress)))
          : undefined;
        return {
          id: meta.id,
          label: meta.description,
          progress,
        };
      })
      .filter((item): item is { id: string; label: string; progress?: number } => Boolean(item));

    const finalPercent = clampPercentValue(computedPercent);

    await onSubmit({
      percent: finalPercent,
      description: values.description.trim(),
      start: range.start,
      end: range.end,
      date: values.date,
      reportDate,
      subactivities: subactivityUpdates,
      resources: (values.resources ?? [])
        .map((resourceId) => RESOURCE_OPTIONS.find((option) => option.id === resourceId)?.label ?? resourceId)
        .filter((label) => typeof label === "string" && label.trim().length > 0)
        .map((label) => ({ name: label })),
      workforce: values.workforce.map((item) => ({ role: item.role.trim(), quantity: Math.max(1, Math.round(item.quantity)) })),
      shiftConditions: values.shifts.map((item) => ({
        shift: item.shift,
        weather: item.weather,
        condition: item.condition,
      })),
      declarationAccepted: true,
      evidences,
    });

    // Após um envio, permitir que o percentual volte a acompanhar o progresso do serviço
    reset({
      date: "",
      description: "",
      resources: [],
      workforce: [{ role: "", quantity: 1 }],
      shifts: [],
      declarationAccepted: false,
      subactivities: safeChecklist.map((item) => ({ id: item.id, progress: undefined })),
    });
    setPendingEvidences([]);
  }

  async function handleEvidenceFileChange(event: { target: { files?: FileList | null }; currentTarget: HTMLInputElement; }) {
    if (!onUploadEvidence) return;
    const files = Array.from(event.target.files ?? []);
    if (files.length === 0) return;

    async function optimizeImageForUpload(originalFile: File): Promise<File> {
      const shouldOptimize = originalFile.type.startsWith("image/") && (originalFile.size > 1_500_000);
      if (!shouldOptimize) return originalFile;
      try {
        // HEIC/HEIF costuma ter baixa compatibilidade de decode em canvas no mobile.
        // Nesses casos mantemos o arquivo original para evitar falha silenciosa.
        if (originalFile.type.includes("heic") || originalFile.type.includes("heif")) {
          return originalFile;
        }

        const imageUrl = URL.createObjectURL(originalFile);
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = () => reject(new Error("Falha ao carregar imagem para otimização."));
          img.src = imageUrl;
        });
        const maxDimension = 1280;
        const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
        const targetWidth = Math.max(1, Math.round(image.width * scale));
        const targetHeight = Math.max(1, Math.round(image.height * scale));

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const context = canvas.getContext("2d");
        if (!context) return originalFile;
        context.drawImage(image, 0, 0, targetWidth, targetHeight);
        URL.revokeObjectURL(imageUrl);

        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob(resolve, "image/jpeg", 0.75);
        });
        if (!blob) return originalFile;

        return new File([blob], originalFile.name.replace(/\.[^.]+$/, ".jpg"), {
          type: "image/jpeg",
          lastModified: Date.now(),
        });
      } catch {
        return originalFile;
      }
    }

    async function fileToDataUrl(inputFile: File): Promise<string> {
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
        reader.onerror = () => reject(new Error("Falha ao gerar preview da imagem."));
        reader.readAsDataURL(inputFile);
      });
    }

    try {
      setEvidenceUploadError(null);
      setUploadingEvidence(true);
      const availableSlots = Math.max(0, 5 - pendingEvidences.length);
      if (availableSlots === 0) {
        setEvidenceUploadError("Limite de 5 fotos atingido.");
        return;
      }
      const selected = files.slice(0, availableSlots);
      const prepared = await Promise.all(
        selected.map(async (selectedFile) => {
          const optimizedFile = await optimizeImageForUpload(selectedFile);
          const previewUrl = await fileToDataUrl(optimizedFile);
          return { file: optimizedFile, previewUrl, label: optimizedFile.name };
        }),
      );
      setPendingEvidences((prev) => [...prev, ...prepared].slice(0, 5));
    } catch {
      setEvidenceUploadError("Não foi possível adicionar a foto. Tente outra imagem ou aguarde e tente novamente.");
    } finally {
      setUploadingEvidence(false);
      event.currentTarget.value = "";
    }
  }

  async function submitWithEvidenceUpload(values: FormValues) {
    if (!onUploadEvidence) return;
    setEvidenceUploadError(null);
    setUploadingEvidence(true);
    try {
      const evidences: Array<{ url: string; label?: string }> = [];
      for (const evidence of pendingEvidences) {
        try {
          const uploaded = await onUploadEvidence(evidence.file);
          evidences.push(uploaded);
        } catch {
          // Não bloquear o registro da atualização por falha pontual de foto
        }
      }
      if (pendingEvidences.length > 0 && evidences.length === 0) {
        setEvidenceUploadError("Não foi possível enviar as fotos, mas a atualização será registrada sem evidências.");
      } else if (evidences.length < pendingEvidences.length) {
        setEvidenceUploadError("Algumas fotos falharam no envio. A atualização será registrada com as fotos enviadas.");
      }
      await submit(values, evidences);
    } catch {
      setEvidenceUploadError("Não foi possível registrar a atualização. Tente novamente.");
    } finally {
      setUploadingEvidence(false);
    }
  }

  return (
    <form onSubmit={handleSubmit(submitWithEvidenceUpload)} className="space-y-6">
      <div className="rounded-xl border bg-card/80 p-4 shadow-sm">
        <label htmlFor={`${serviceId}-evidence`} className="text-sm font-medium text-foreground">
          Fotos da atualização (até 5)
        </label>
        <input
          ref={evidenceInputRef}
          id={`${serviceId}-evidence`}
          type="file"
          accept="image/*"
          multiple
          className="sr-only"
          disabled={!onUploadEvidence || uploadingEvidence || pendingEvidences.length >= 5}
          onChange={handleEvidenceFileChange}
        />
        <button
          type="button"
          className={cn(
            "mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium transition-colors",
            "hover:bg-accent hover:text-accent-foreground active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50",
          )}
          disabled={!onUploadEvidence || uploadingEvidence || pendingEvidences.length >= 5}
          onClick={() => evidenceInputRef.current?.click()}
        >
          <ImagePlus className="h-4 w-4" />
          {uploadingEvidence ? "Enviando foto..." : "Adicionar foto"}
        </button>
        <p className="mt-2 text-xs text-muted-foreground">
          Escolha da câmera ou da galeria. Imagens grandes são reduzidas automaticamente para upload mais rápido.
        </p>
        {uploadingEvidence ? <p className="mt-1 text-xs text-muted-foreground">Enviando foto...</p> : null}
        {evidenceUploadError ? <p className="mt-1 text-xs text-destructive">{evidenceUploadError}</p> : null}
        {pendingEvidences.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2">
            {pendingEvidences.map((item, index) => (
              <li key={`${item.previewUrl}-${index}`} className="relative">
                <img
                  src={item.previewUrl}
                  alt={item.label || `Evidência ${index + 1}`}
                  className="h-16 w-16 rounded-md border object-cover sm:h-20 sm:w-20"
                />
                <button
                  type="button"
                  aria-label={`Remover imagem ${index + 1}`}
                  className="absolute -right-2 -top-2 inline-flex h-7 w-7 items-center justify-center rounded-full border bg-background text-destructive shadow-sm transition-colors hover:bg-destructive/10 active:scale-95"
                  onClick={() =>
                    setPendingEvidences((prev) => {
                      return prev.filter((_, evidenceIndex) => evidenceIndex !== index);
                    })
                  }
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div>
        <label htmlFor={`${serviceId}-date`} className="text-sm font-medium text-foreground">
          Data
        </label>
        <input id={`${serviceId}-date`} type="date" className="input mt-1 w-full" {...register("date")} />
        {errors.date ? <p className="mt-1 text-xs text-destructive">{errors.date.message}</p> : null}
      </div>
      {safeChecklist.length > 0 ? (
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-foreground">Subatividades / Etapas</h3>
          <p className="text-xs text-muted-foreground">
            Informe o percentual atualizado para cada subatividade de acordo com o progresso realizado.
          </p>
          <ul className="grid gap-3 text-sm md:grid-cols-2">
            {safeChecklist.map((item, index) => {
              const fieldError = extractFieldErrorMessage(errors.subactivities?.[index]?.progress);
              const currentValue =
                typeof subactivityValues?.[index]?.progress === "number"
                  ? subactivityValues[index]?.progress
                  : undefined;
              const displayProgress =
                typeof realizedPercent === "number" && Number.isFinite(realizedPercent)
                  ? Math.round(realizedPercent)
                  : typeof computedPercent === "number" && Number.isFinite(computedPercent)
                    ? Math.round(computedPercent)
                    : Math.round(item.progress ?? 0);
              return (
                <li key={item.id} className="space-y-2 rounded-lg border p-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium text-foreground">{item.description}</span>
                    <span className="text-xs text-muted-foreground">
                      Progresso atual registrado: {displayProgress}%
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      id={`${serviceId}-subactivity-${item.id}`}
                      type="number"
                      min={0}
                      max={100}
                      step={1}
                      placeholder="0"
                      className="input w-24"
                      {...register(`subactivities.${index}.progress`, {
                        setValueAs: (value) => {
                          if (value === "" || value === null || typeof value === "undefined") {
                            return undefined;
                          }
                          const numeric = Number(String(value).replace(",", "."));
                          if (!Number.isFinite(numeric)) return undefined;
                          const clamped = Math.max(0, Math.min(100, Math.round(numeric)));
                          return clamped;
                        },
                      })}
                    />
                    <span className="text-xs text-muted-foreground">%</span>
                    {typeof currentValue === "number" ? (
                      <span className="text-xs text-muted-foreground">Novo valor: {currentValue}%</span>
                    ) : null}
                  </div>
                  {fieldError ? <p className="text-xs text-destructive">{fieldError}</p> : null}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div>
        <label htmlFor={`${serviceId}-description`} className="text-sm font-medium text-foreground">
          Descrição do que foi realizado
        </label>
        <textarea
          id={`${serviceId}-description`}
          className="input mt-1 min-h-[120px] resize-y"
          placeholder="Detalhe as atividades executadas"
          {...register("description")}
        />
        {errors.description ? <p className="mt-1 text-xs text-destructive">{errors.description.message}</p> : null}
      </div>

      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Recursos utilizados</h3>
        <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {RESOURCE_OPTIONS.map((resource) => {
            const checked = selectedResources?.includes(resource.id) ?? false;
            return (
              <label key={resource.id} className="group relative block">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggleResource(resource.id)}
                />
                <div
                  className={cn(
                    "flex h-full items-center gap-3 rounded-2xl border border-border bg-background/80 p-3 text-left text-sm text-foreground shadow-sm transition duration-200 group-hover:border-primary/60 group-hover:shadow-md",
                    checked && "border-primary bg-primary/10 shadow-md ring-1 ring-primary/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-md border border-border bg-muted/40 text-muted-foreground transition",
                      checked && "border-primary bg-primary/10 text-primary",
                    )}
                  >
                    <Check className={cn("h-3 w-3 transition-opacity", checked ? "opacity-100" : "opacity-0")} />
                  </span>
                  <span className={cn("font-medium leading-snug text-foreground", checked && "text-primary")}>{resource.label}</span>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Mão de obra</h3>
          <button
            type="button"
            className="btn btn-secondary btn-xs"
            onClick={() => workforceArray.append({ role: "", quantity: 1 })}
            disabled={workforceArray.fields.length >= 12}
          >
            Adicionar função
          </button>
        </div>
        {workforceArray.fields.length === 0 ? (
          <p className="text-xs text-muted-foreground">Informe as funções e quantidades utilizadas.</p>
        ) : (
          <div className="space-y-3">
            {workforceArray.fields.map((field, index) => {
              const roleFieldId = `${serviceId}-workforce-role-${index}`;
              const quantityFieldId = `${serviceId}-workforce-quantity-${index}`;
              return (
                <div key={field.id} className="rounded-2xl border border-border bg-background/80 p-3 shadow-sm">
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_140px_auto] sm:items-end">
                    <div className="space-y-1">
                      <label htmlFor={roleFieldId} className="text-xs font-medium text-muted-foreground">
                        Função
                      </label>
                      <select id={roleFieldId} className="input" {...register(`workforce.${index}.role` as const)}>
                        <option value="">Selecione</option>
                        {WORKFORCE_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={quantityFieldId} className="text-xs font-medium text-muted-foreground">
                        Quantidade
                      </label>
                      <input
                        id={quantityFieldId}
                        type="number"
                        className="input"
                        min={1}
                        {...register(`workforce.${index}.quantity` as const, { valueAsNumber: true })}
                      />
                    </div>
                    <div className="flex items-end justify-end">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => workforceArray.remove(index)}
                        disabled={workforceArray.fields.length === 1}
                      >
                        Remover
                      </button>
                    </div>
                  </div>
                  {errors.workforce?.[index]?.role ? (
                    <p className="mt-2 text-xs text-destructive">{errors.workforce[index]?.role?.message}</p>
                  ) : null}
                  {errors.workforce?.[index]?.quantity ? (
                    <p className="mt-1 text-xs text-destructive">{errors.workforce[index]?.quantity?.message}</p>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
        {typeof errors.workforce?.message === "string" ? (
          <p className="text-xs text-destructive">{errors.workforce.message}</p>
        ) : null}
      </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Períodos trabalhados</h3>
          <div className="grid gap-3 sm:grid-cols-3">
            {SHIFT_OPTIONS.map((option) => {
              const checked = selectedShifts.includes(option.id);
              const disabled = !checked && shiftArray.fields.length >= 3;
              return (
                <label
                  key={option.id}
                  className={cn(
                    "group relative block",
                  disabled && !checked && "cursor-not-allowed opacity-60",
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={checked}
                  onChange={() => toggleShift(option.id)}
                  disabled={disabled}
                />
                <div
                  className={cn(
                    "flex h-full items-center justify-center gap-2 rounded-full border border-border bg-background/80 px-4 py-2 text-sm font-medium text-foreground shadow-sm transition duration-200 group-hover:border-primary/60 group-hover:shadow-md",
                    checked && "border-primary bg-primary/10 text-primary shadow-md ring-1 ring-primary/30",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-5 w-5 items-center justify-center rounded-full border border-border bg-muted/40 text-muted-foreground transition",
                      checked && "border-primary bg-primary/10 text-primary",
                    )}
                  >
                    <Check className={cn("h-3 w-3 transition-opacity", checked ? "opacity-100" : "opacity-0")} />
                  </span>
                  {option.label}
                </div>
              </label>
            );
          })}
        </div>
        {errors.shifts && !Array.isArray(errors.shifts) && typeof errors.shifts.message === "string" ? (
          <p className="text-xs text-destructive">{errors.shifts.message}</p>
        ) : null}
        {errors.shifts && !Array.isArray(errors.shifts)
          ? (() => {
              const message = extractFieldErrorMessage(errors.shifts?.root);
              return message ? <p className="text-xs text-destructive">{message}</p> : null;
            })()
          : null}
        {shiftArray.fields.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {shiftArray.fields.map((field, index) => (
              <div key={field.id} className="rounded-2xl border border-border bg-background/80 p-4 shadow-sm">
                <input type="hidden" value={field.shift} {...register(`shifts.${index}.shift` as const)} />
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold text-foreground">
                    {SHIFT_OPTIONS.find((option) => option.id === field.shift)?.label ?? field.shift}
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 [@media(min-width:360px)]:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Tempo</label>
                    <select className="input" {...register(`shifts.${index}.weather` as const)}>
                      {WEATHER_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-muted-foreground">Condição de trabalho</label>
                    <select className="input" {...register(`shifts.${index}.condition` as const)}>
                      {CONDITION_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Selecione até três turnos trabalhados e informe as condições.</p>
        )}
        {Array.isArray(errors.shifts)
          ? errors.shifts.map((error, index) => (
              <div key={index} className="text-xs text-destructive">
                {error?.shift?.message || error?.weather?.message || error?.condition?.message}
              </div>
            ))
          : null}
      </div>

      <label className="flex items-start gap-2 rounded-lg border border-muted bg-muted/40 p-4 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4" {...register("declarationAccepted")} />
        <span>{declarationText}</span>
      </label>
      {errors.declarationAccepted ? (
        <p className="-mt-3 text-xs text-destructive">{errors.declarationAccepted.message}</p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={isSubmitting}>
        {isSubmitting ? "Enviando..." : "Registrar atualização"}
      </button>
      <button type="button" className="btn btn-ghost w-full" onClick={handleBack}>
        Voltar
      </button>
    </form>
  );
}
