import type { Service } from "@/lib/types";
import { DEFAULT_TIME_ZONE, startOfDayInTimeZone } from "@/lib/referenceDate";

export type PublicSubpackageService = {
  id: string;
  title: string;
  subtitle: string | null;
  tag: string | null;
  description: string | null;
  status: string;
  progress: number;
  lastUpdateAt: number | null;
};

function toMillis(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (value && typeof value === "object") {
    const timestamp = value as { toMillis?: () => number; toDate?: () => Date };
    if (typeof timestamp.toMillis === "function") return timestamp.toMillis();
    if (typeof timestamp.toDate === "function") return timestamp.toDate().getTime();
  }
  return null;
}

function resolveProgress(service: Service): number {
  const candidates = [
    service.andamento,
    service.percentualRealAtual,
    service.realPercentSnapshot,
    service.manualPercent,
    service.realPercent,
    service.progress,
    service.previousProgress,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return Math.min(100, Math.max(0, Math.round(value)));
    }
  }
  return 0;
}

function serviceTitle(service: Service): string {
  if (service.os) return `OS ${service.os}`;
  if (service.tag) return service.tag;
  if (service.code) return `Código ${service.code}`;
  return `Serviço ${service.id}`;
}

function statusLabel(status: Service["status"], progress: number): string {
  const raw = String(status ?? "").trim().toLowerCase();
  if (progress >= 100 || raw.includes("conclu")) return "Concluído";
  if (raw === "pendente") return "Pendente";
  if (raw.includes("andamento")) return "Em andamento";
  return "Aberto";
}

export function toPublicSubpackageService(service: Service): PublicSubpackageService {
  const progress = resolveProgress(service);
  return {
    id: service.id,
    title: serviceTitle(service),
    subtitle: service.equipmentName?.trim() || null,
    tag: service.tag?.trim() || null,
    description: service.description?.trim() || null,
    status: statusLabel(service.displayStatus ?? service.status, progress),
    progress,
    lastUpdateAt:
      toMillis(service.lastProgressUpdateAt) ??
      toMillis(service.lastUpdateDate) ??
      toMillis(service.updatedAt),
  };
}

export function sortPublicSubpackageServices(
  services: PublicSubpackageService[],
): PublicSubpackageService[] {
  return [...services].sort((left, right) => {
    const leftCompleted = left.progress >= 100 || left.status === "Concluído";
    const rightCompleted = right.progress >= 100 || right.status === "Concluído";
    if (leftCompleted !== rightCompleted) return leftCompleted ? 1 : -1;
    return left.title.localeCompare(right.title, "pt-BR", { sensitivity: "base" });
  });
}

export type LastUpdateStage = "today" | "yesterday" | "before";

export function resolveLastUpdateStage(lastUpdateAt: number | null, now = Date.now()): LastUpdateStage {
  if (lastUpdateAt === null) return "before";
  const startToday = startOfDayInTimeZone(new Date(now), DEFAULT_TIME_ZONE);
  const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000);
  if (lastUpdateAt >= startToday.getTime()) return "today";
  if (lastUpdateAt >= startYesterday.getTime()) return "yesterday";
  return "before";
}
