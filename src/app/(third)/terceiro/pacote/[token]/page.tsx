export const dynamic = "force-dynamic";
export const revalidate = 0;

import Link from "next/link";

import { getPackageShareByToken } from "@/lib/repo/packageShares";
import { getServicesByIds } from "@/lib/repo/services";
import type { Service } from "@/lib/types";
import { formatDate } from "@/lib/formatDateTime";
import { AdminDbUnavailableError } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";

const DATE_FORMAT_OPTIONS = { timeZone: "America/Sao_Paulo", fallback: "—" } as const;

function normaliseStatus(value?: string | null): string {
  const raw = String(value ?? "").trim().toLowerCase();
  if (raw.includes("conclu")) return "Concluído";
  if (raw === "pendente") return "Pendente";
  if (raw.includes("andamento")) return "Em andamento";
  return "Aberto";
}

function deriveStatusLabel(status: Service["status"], progress: number): string {
  const normalised = normaliseStatus(status);
  if (normalised === "Pendente") return normalised;
  if (progress >= 100) return "Concluído";
  return normalised;
}

function resolveProgress(service: Service): number {
  const candidates = [service.realPercent, service.progress, service.andamento, service.previousProgress];
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

function serviceSubtitle(service: Service): string | null {
  if (service.equipmentName) return service.equipmentName;
  if (service.company) return `Empresa: ${service.company}`;
  if (service.assignedTo?.companyName) return `Empresa: ${service.assignedTo.companyName}`;
  return null;
}

function formatDateLabel(value?: string | number | null): string {
  if (value === null || value === undefined || value === "") return "—";
  return formatDate(value, DATE_FORMAT_OPTIONS) || "—";
}

function formatHours(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  const formatter = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 });
  return `${formatter.format(value)}h`;
}

export default async function TerceiroPacotePublicoPage({ params }: { params: { token: string } }) {
  const token = params.token?.trim();
  if (!token) {
    return <div className="card p-6">Link inválido ou expirado.</div>;
  }

  try {
    const share = await getPackageShareByToken(token);
    if (!share) {
      return <div className="card p-6">Link inválido ou expirado.</div>;
    }

    const services = await getServicesByIds(share.serviceIds, { mode: "summary" });
    const missingServices = share.serviceIds.filter((id) => !services.some((service) => service.id === id));

    const sortedServices = [...services].sort((a, b) =>
      serviceTitle(a).localeCompare(serviceTitle(b), "pt-BR", { sensitivity: "base" }),
    );

    const expiresLabel = share.expiresAt
      ? formatDate(share.expiresAt, DATE_FORMAT_OPTIONS)
      : null;
    const createdLabel = formatDate(share.createdAt, DATE_FORMAT_OPTIONS);

    return (
      <div className="container-page max-w-5xl pb-16">
        <Link href="/" className="link inline-flex items-center gap-1 mb-4">
          ← Voltar
        </Link>

        <div className="card bg-card/60 p-6 shadow-sm backdrop-blur">
          <h1 className="mb-2 text-2xl font-semibold tracking-tight">Serviços compartilhados</h1>
          <p className="text-sm text-muted-foreground">
            Confira abaixo os serviços disponibilizados através deste link público. Nenhuma autenticação é necessária
            para visualizar os detalhes gerais.
          </p>
          <p className="mt-3 text-xs text-muted-foreground">
            Link gerado em {createdLabel}.
            {expiresLabel ? ` Expira em ${expiresLabel}.` : ""}
          </p>
          {missingServices.length ? (
            <p className="mt-2 text-xs text-amber-600">
              {missingServices.length === 1
                ? `O serviço ${missingServices[0]} não pôde ser carregado.`
                : `Os serviços ${missingServices.join(", ")} não puderam ser carregados.`}
            </p>
          ) : null}
        </div>

        {sortedServices.length === 0 ? (
          <div className="mt-6 card p-6 text-sm text-muted-foreground">
            Nenhum serviço disponível foi encontrado para este compartilhamento.
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            {sortedServices.map((service) => {
              const progress = resolveProgress(service);
              const statusLabel = deriveStatusLabel(service.status, progress);
              const subtitle = serviceSubtitle(service);
              return (
                <article key={service.id} className="card border shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b px-6 py-4">
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-lg font-semibold text-foreground">{serviceTitle(service)}</h2>
                      <p className="text-sm text-muted-foreground">{subtitle ?? `ID: ${service.id}`}</p>
                    </div>
                    <div className="flex flex-col items-end gap-2 text-sm font-semibold">
                      <span
                        className={`rounded-full px-3 py-1 ${
                          statusLabel === "Concluído"
                            ? "border border-emerald-200 bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200/70 dark:border-emerald-700/70 dark:bg-emerald-900/40 dark:text-emerald-50 dark:ring-emerald-700/60"
                            : "border border-primary/40 bg-primary/10 text-primary"
                        }`}
                      >
                        {statusLabel}
                      </span>
                      <span className="text-muted-foreground">{progress}% concluído</span>
                    </div>
                  </div>

                  <div className="px-6 py-4">
                    <dl className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">OS</dt>
                        <dd className="text-sm text-foreground">{service.os?.trim() || "—"}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tag</dt>
                        <dd className="text-sm text-foreground">{service.tag?.trim() || "—"}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Código</dt>
                        <dd className="text-sm text-foreground">{service.code?.trim() || "—"}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Equipamento</dt>
                        <dd className="text-sm text-foreground">{service.equipmentName?.trim() || "—"}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Descrição</dt>
                        <dd className="text-sm text-foreground">{service.description?.trim() || "—"}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Setor</dt>
                        <dd className="text-sm text-foreground">{service.sector?.trim() || service.setor?.trim() || "—"}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Empresa</dt>
                        <dd className="text-sm text-foreground">
                          {service.company?.trim() || service.assignedTo?.companyName?.trim() || service.empresa?.trim() || "—"}
                        </dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Início previsto</dt>
                        <dd className="text-sm text-foreground">{formatDateLabel(service.plannedStart)}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Término previsto</dt>
                        <dd className="text-sm text-foreground">{formatDateLabel(service.plannedEnd)}</dd>
                      </div>
                      <div className="space-y-1">
                        <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Horas totais</dt>
                        <dd className="text-sm text-foreground">{formatHours(service.totalHours)}</dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-4 border-t bg-muted/40 px-6 py-4 text-sm text-muted-foreground">
                    <Link
                      href={`/s/${service.id}?token=${encodeURIComponent(token)}`}
                      className="btn btn-primary"
                    >
                      PREENCHER RDO
                    </Link>
                    <span className="text-foreground">Pacote vinculado: {service.packageId ?? "Não informado"}</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    );
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error(`[terceiro/pacote/${token}] Firebase Admin não configurado`, error);
      return <div className="card p-6">Configuração de acesso ao banco indisponível.</div>;
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn(`[terceiro/pacote/${token}] Falha ao carregar compartilhamento`, error);
      const message = mapped.status === 404 ? "Link inválido ou expirado." : mapped.message;
      return <div className="card p-6">{message}</div>;
    }

    console.error(`[terceiro/pacote/${token}] Erro inesperado`, error);
    return <div className="card p-6">Não foi possível carregar o compartilhamento público.</div>;
  }
}
