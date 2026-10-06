import { resolveServicoRealPercent } from "./serviceProgress";
import type { Service } from "@/types";

type ServiceStatusLabel = "Aberto" | "Pendente" | "Concluído" | "Encerrado" | string;
export type CanonicalServiceStatus = "Aberto" | "Pendente" | "Concluído";

export function normaliseServiceStatus(status: Service["status"] | string | null | undefined): ServiceStatusLabel {
  const raw = String(status ?? "").toLowerCase();
  if (raw === "concluido" || raw === "concluído") return "Concluído";
  if (raw === "encerrado") return "Encerrado";
  if (raw === "pendente") return "Pendente";
  return "Aberto";
}

export function resolveDisplayedServiceStatus(
  service: Service,
  options?: {
    realizedPercent?: number | null;
    referenceDate?: Parameters<typeof resolveServicoRealPercent>[1];
  },
): ServiceStatusLabel {
  const normalised = normaliseServiceStatus(service.status);
  const realizedPercent =
    typeof options?.realizedPercent === "number"
      ? options.realizedPercent
      : resolveServicoRealPercent(service, options?.referenceDate);

  if (Number.isFinite(realizedPercent) && realizedPercent >= 100) {
    return "Concluído";
  }

  return normalised;
}

export function resolveCanonicalServiceStatus(
  service: Service,
  options?: Parameters<typeof resolveDisplayedServiceStatus>[1],
): CanonicalServiceStatus {
  const displayed = resolveDisplayedServiceStatus(service, options);
  if (displayed === "Concluído") return "Concluído";
  if (displayed === "Pendente") return "Pendente";
  return "Aberto";
}

export function completeLegacyServiceStatusSummary(summary: {
  total: number;
  open: number;
  pending: number;
  concluded: number;
}) {
  const classified = summary.open + summary.pending + summary.concluded;
  return { ...summary, open: summary.open + Math.max(0, summary.total - classified) };
}
