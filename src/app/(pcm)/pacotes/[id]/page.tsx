import Link from "next/link";
import * as Navigation from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect";
import DeletePackageButton from "@/components/DeletePackageButton.dynamic";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { getPackageByIdCached, listPackageServices } from "@/lib/repo/packages";
import { listPackageFolders } from "@/lib/repo/folders";
import { getServicesByIds, listAvailableOpenServices, listUpdates } from "@/lib/repo/services";
import { formatDate as formatDisplayDate } from "@/lib/formatDateTime";
import { formatCanonicalProgressLabel, formatUpdateSummary } from "@/lib/serviceUpdates";
import {
  calcularCurvaSPlanejada,
  calcularCurvaSRealizada,
  calcularMetricasPorSetor,
  calcularMetricasSubpacote,
  calcularPercentualPlanejadoPacote,
  calcularPercentualRealizadoPacote,
  calcularPercentualSubpacote,
  calcularPercentualRealizadoSubpacote,
  obterIntervaloSubpacote,
  resolveServicoPercentualPlanejado,
  resolveServicoRealPercent,
  toDate,
  type ServicoDoSubpacote,
} from "@/lib/serviceProgress";
import { normaliseServiceStatus, resolveDisplayedServiceStatus } from "@/lib/serviceStatus";
import type { Package, PackageFolder, Service, ServiceUpdate } from "@/types";
import { resolveReferenceDate } from "@/lib/referenceDate";
import { selectMissingFolderServices } from "@/lib/packageServiceSelection";

import type { ServiceInfo as FolderServiceInfo, ServiceOption as FolderServiceOption } from "./PackageFoldersManager";
import ServicesCompaniesSection from "./ServicesCompaniesSection";
import PackageFoldersManagerClient from "./PackageFoldersManager.client";
import PackagePdfExportButton from "./PackagePdfExportButton";
import PackageExcelExportButton from "./PackageExcelExportButton";
import PackageImportServicesButton from "./PackageImportServicesButton";
import PackageSCurveSection from "./_components/package-scurve/PackageSCurveSection";
import PackageReferenceDateSelector from "./PackageReferenceDateSelector.client";

const { notFound } = Navigation;

export const dynamic = "force-dynamic";
export const revalidate = 0;

const MAX_SERVICES_TO_LOAD = 650;

type CurvePoint = { date: string; percent: number };

type PackageFolderWithProgress = PackageFolder & {
  progressPercent?: number | null;
  realizedPercent?: number | null;
  startDateMs?: number | null;
  endDateMs?: number | null;
};

function parsePackageDateOnly(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnlyToIso(date: Date) {
  return date.toISOString().slice(0, 10);
}

function getCurveValueAtDate(curve: CurvePoint[], target: Date) {
  const targetMs = target.getTime();
  let previous: CurvePoint | null = null;

  for (const point of curve) {
    const pointDate = parsePackageDateOnly(point.date);
    if (!pointDate) continue;
    const pointMs = pointDate.getTime();
    if (pointMs === targetMs) return point.percent;
    if (pointMs > targetMs) return previous?.percent ?? point.percent;
    previous = point;
  }

  return previous?.percent ?? null;
}

function limitCurveDatesToPackageRange(
  curve: CurvePoint[],
  plannedStart?: string | null,
  plannedEnd?: string | null,
  options: { includeEndPoint?: boolean } = {},
) {
  const packageStart = parsePackageDateOnly(plannedStart);
  const packageEnd = parsePackageDateOnly(plannedEnd);
  if (!packageStart || !packageEnd || packageEnd < packageStart || !curve.length) return curve;

  const startIso = dateOnlyToIso(packageStart);
  const endIso = dateOnlyToIso(packageEnd);
  const packageStartMs = packageStart.getTime();
  const packageEndMs = packageEnd.getTime();
  const pointsByDate = new Map<string, CurvePoint>();
  const startPercent = getCurveValueAtDate(curve, packageStart);
  const endPercent = getCurveValueAtDate(curve, packageEnd);

  if (startPercent !== null) {
    pointsByDate.set(startIso, { date: startIso, percent: startPercent });
  }

  curve.forEach((point) => {
    const pointDate = parsePackageDateOnly(point.date);
    if (!pointDate) return;
    const pointMs = pointDate.getTime();
    if (pointMs < packageStartMs || pointMs > packageEndMs) return;
    pointsByDate.set(dateOnlyToIso(pointDate), { ...point, date: dateOnlyToIso(pointDate) });
  });

  if (options.includeEndPoint !== false && endPercent !== null) {
    pointsByDate.set(endIso, { date: endIso, percent: endPercent });
  }

  return Array.from(pointsByDate.values()).sort((a, b) => {
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });
}

const PACKAGE_STATUS_TONE: Record<string, string> = {
  Concluído: "bg-emerald-100 text-emerald-700 border-emerald-200",
  Encerrado: "bg-slate-200 text-slate-700 border-slate-300",
  Aberto: "bg-sky-100 text-sky-700 border-sky-200",
};

function renderPackageLoadFailure(packageLabel: string, warnings: string[] = []) {
  const uniqueWarnings = Array.from(
    new Set(warnings.filter((message) => typeof message === "string" && message.trim().length > 0)),
  );

  return (
    <div className="container mx-auto max-w-4xl space-y-6 px-4 py-6">
      <div className="rounded-2xl border bg-card/80 p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{packageLabel}</h1>
          <p className="text-sm text-muted-foreground">
            Não foi possível carregar as informações deste pacote no momento.
          </p>
        </div>
        {uniqueWarnings.length ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {uniqueWarnings.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        ) : null}
        <Link className="btn btn-secondary mt-4 w-fit" href="/pacotes">
          Voltar
        </Link>
      </div>
    </div>
  );
}

function parseISO(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function formatDate(value?: string | null) {
  const date = parseISO(value ?? undefined);
  if (!date) return "-";
  return formatDisplayDate(date, { timeZone: "America/Sao_Paulo", fallback: "-" }) || "-";
}

function mapServiceToSubpackageEntry(service: Service): ServicoDoSubpacote {
  const updates = service.updates ?? [];
  const label = service.os || service.code || service.id;
  const dataInicio =
    service.dataInicio ??
    service.inicioPrevisto ??
    service.inicioPlanejado ??
    service.plannedStart ??
    service.startDate ??
    null;
  const dataFim =
    service.dataFim ??
    service.fimPrevisto ??
    service.fimPlanejado ??
    service.plannedEnd ??
    service.endDate ??
    null;
  const horasPrevistas =
    service.totalHours ??
    service.horasPrevistas ??
    service.horas ??
    service.hours ??
    service.peso ??
    service.weight ??
    null;
  const entry: ServicoDoSubpacote = {
    id: service.id,
    nome: label,
    horasPrevistas,
    totalHours: service.totalHours,
    horas: service.horas,
    hours: service.hours,
    peso: service.peso,
    weight: service.weight,
    dataInicio,
    inicioPrevisto: service.inicioPrevisto,
    inicioPlanejado: service.inicioPlanejado,
    plannedStart: service.plannedStart ?? dataInicio ?? undefined,
    startDate: service.startDate ?? dataInicio ?? undefined,
    dataFim,
    fimPrevisto: service.fimPrevisto,
    fimPlanejado: service.fimPlanejado,
    plannedEnd: service.plannedEnd ?? dataFim ?? undefined,
    endDate: service.endDate ?? dataFim ?? undefined,
    percentualRealAtual: service.progress ?? service.realPercent ?? service.andamento ?? null,
    updates,
    atualizacoes: updates,
  };

  const updateListKeys = [
    "atualizacoes",
    "historicoAtualizacoes",
    "historico",
    "history",
    "updates",
    "progressUpdates",
    "percentualUpdates",
    "realUpdates",
  ] as const;
  updateListKeys.forEach((key) => {
    const value = (service as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      (entry as Record<string, unknown>)[key] = value;
    }
  });

  const updateDateKeys = [
    "reportDate",
    "reportDateMillis",
    "date",
    "dataAtualizacao",
    "dataAtualizacaoPercentual",
  ] as const;
  updateDateKeys.forEach((key) => {
    if (Object.hasOwn(service as Record<string, unknown>, key)) {
      (entry as Record<string, unknown>)[key] = (service as Record<string, unknown>)[key];
    }
  });

  return entry;
}

function clampPercent(value?: number | null) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(100, value));
}

function parsePercent(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return clampPercent(value);
  }
  if (typeof value === "string") {
    const sanitized = value.replace(/%/g, "").trim();
    const parsed = Number(sanitized.replace(",", "."));
    if (Number.isFinite(parsed)) return clampPercent(parsed);
  }
  return null;
}

function resolveServiceHours(service: Service) {
  const hours =
    service.totalHours ??
    (service as { horas?: number | null }).horas ??
    (service as { hours?: number | null }).hours ??
    (service as { peso?: number | null }).peso ??
    (service as { weight?: number | null }).weight ??
    0;
  return Number.isFinite(hours) ? Number(hours) : 0;
}

function extractDateMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.getTime();
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    if (Number.isFinite(parsed.getTime())) return parsed.getTime();
  }
  return null;
}

function buildServiceProgressSnapshot(service: Service, dataReferencia?: Parameters<typeof toDate>[0]) {
  const reference = toDate(dataReferencia ?? new Date()) ?? new Date();
  const plannedPercent = resolveServicoPercentualPlanejado(service, reference);
  // Use the shared progress resolver so reopened/pendente services reuse their stored progress
  // and concluded ones only reach 100% when their real updates do, keeping parity with the
  // dashboard and other service listings.
  const realizedPercent = resolveServicoRealPercent(service, reference);
  const deltaPercent = Number.isFinite(realizedPercent - plannedPercent) ? realizedPercent - plannedPercent : null;
  const startDateMs =
    extractDateMs(service.dataInicio) ??
    extractDateMs(service.inicioPrevisto) ??
    extractDateMs(service.inicioPlanejado) ??
    extractDateMs(service.plannedStart) ??
    extractDateMs(service.startDate);
  const endDateMs =
    extractDateMs(service.dataFim) ??
    extractDateMs(service.fimPrevisto) ??
    extractDateMs(service.fimPlanejado) ??
    extractDateMs(service.plannedEnd) ??
    extractDateMs(service.endDate);

  return { plannedPercent, realizedPercent, deltaPercent, startDateMs, endDateMs };
}

const LAST_UPDATE_KEYS = [
  "dataUltimaAtualizacao",
  "dataAtualizacao",
  "dataAtualizacaoPercentual",
  "atualizadoEm",
  "lastUpdateDate",
  "updatedAt",
] as const;

function resolveServiceLastUpdateMs(service: Service): number | null {
  const record = service as Record<string, unknown>;
  for (const key of LAST_UPDATE_KEYS) {
    if (!Object.hasOwn(record, key)) continue;
    const value = record[key];
    const millis = extractDateMs(value);
    if (millis !== null) return millis;
  }

  const created = extractDateMs((service as { createdAt?: unknown }).createdAt);
  return created ?? null;
}

function getLatestServiceUpdate(service: Service): ServiceUpdate | null {
  const raw = service as Record<string, unknown>;
  const updates = Array.isArray(service.updates)
    ? service.updates
    : Array.isArray(raw.atualizacoes)
    ? raw.atualizacoes
    : [];

  const validUpdates = updates.filter(
    (update): update is ServiceUpdate => Boolean(update && typeof (update as ServiceUpdate).createdAt === "number"),
  );
  if (!validUpdates.length) return null;

  return validUpdates
    .slice()
    .sort((a, b) => (b.date ?? b.createdAt ?? 0) - (a.date ?? a.createdAt ?? 0))[0] ?? null;
}

async function renderPackageDetailPage(
  params: { id: string },
  searchParams?: Record<string, string | string[] | undefined>,
) {
  const rawPackageId = params.id;
  const decodedPackageId = decodeRouteParam(rawPackageId);
  const packageIdCandidates = Array.from(
    new Set([decodedPackageId, rawPackageId].filter((value) => typeof value === "string" && value.length > 0)),
  );
  if (packageIdCandidates.length === 0) {
    return notFound();
  }
  const warningSet = new Set<string>();
  const registerWarning = (message: string, error?: unknown, context?: string) => {
    if (error) {
      console.error(`[PackageDetailPage:${rawPackageId}] ${context ?? message}`, error);
    }
    warningSet.add(message);
  };

  const refDateParamRaw = searchParams?.refDate;
  const refDateValue = Array.isArray(refDateParamRaw) ? refDateParamRaw[0] : refDateParamRaw ?? null;
  const { date: referenceDate, inputValue: referenceDateInput } = resolveReferenceDate(refDateValue);

  let pkg: Package | null = null;
  let resolvedPackageId = packageIdCandidates[0];

  for (const candidate of packageIdCandidates) {
    try {
      const result = await getPackageByIdCached(candidate);
      if (result) {
        pkg = result;
        resolvedPackageId = result.id ?? candidate;
        break;
      }
    } catch (error) {
      registerWarning(
        "Não foi possível carregar as informações do pacote. Verifique a configuração do Firebase ou tente novamente.",
        error,
        `Falha ao buscar pacote ${candidate}`,
      );
    }
  }

  const displayPackageId =
    pkg?.id ?? (decodedPackageId && decodedPackageId.length > 0 ? decodedPackageId : rawPackageId);

  if (!pkg) {
    const fallbackWarnings = Array.from(warningSet);
    if (fallbackWarnings.length === 0) {
      return notFound();
    }

    return renderPackageLoadFailure(displayPackageId, fallbackWarnings);
  }

  let services: Service[] = [];
  let hasServiceOverflow = false;

  const declaredServiceRefs = (() => {
    if (Array.isArray(pkg.serviceIds) && pkg.serviceIds.length) {
      return pkg.serviceIds;
    }
    if (Array.isArray(pkg.services) && pkg.services.length) {
      return pkg.services;
    }
    return [];
  })();

  const uniqueServiceIds = Array.from(
    new Set(
      declaredServiceRefs
        .map((value) => {
          if (typeof value === "string") return value.trim();
          if (typeof value === "number" && Number.isFinite(value)) return String(value);
          return "";
        })
        .filter((value) => value.length > 0),
    ),
  );

  const serviceIdsToFetch = uniqueServiceIds.slice(0, MAX_SERVICES_TO_LOAD);
  if (uniqueServiceIds.length > serviceIdsToFetch.length) {
    hasServiceOverflow = true;
  }

  if (serviceIdsToFetch.length) {
    try {
      const fetched = await getServicesByIds(serviceIdsToFetch, { mode: "full" });
      services = fetched;
      const fetchedIds = new Set(fetched.map((service) => service.id));
      const missing = serviceIdsToFetch.filter((id) => !fetchedIds.has(id));
      if (missing.length) {
        registerWarning(
          "Alguns serviços vinculados ao pacote não puderam ser carregados completamente.",
          undefined,
          missing.join(", "),
        );
      }
    } catch (error) {
      registerWarning(
        "Não foi possível carregar os serviços vinculados ao pacote.",
        error,
        "Falha ao buscar serviços do pacote",
      );
    }
  }

  let serviceCountReference = uniqueServiceIds.length;
  let serviceCountIsExact = uniqueServiceIds.length > 0;

  if (!services.length) {
    try {
      const fallbackLimit = MAX_SERVICES_TO_LOAD + 1;
      const fallback = await listPackageServices(resolvedPackageId, { limit: fallbackLimit });
      if (fallback.length) {
        if (fallback.length > MAX_SERVICES_TO_LOAD) {
          hasServiceOverflow = true;
          if (serviceCountReference === 0) {
            serviceCountIsExact = false;
            serviceCountReference = MAX_SERVICES_TO_LOAD + 1;
          }
        } else if (serviceCountReference === 0) {
          serviceCountReference = fallback.length;
          serviceCountIsExact = fallback.length < fallbackLimit;
        }

        const fallbackSlice = fallback.slice(0, MAX_SERVICES_TO_LOAD);

        let enriched: Service[] = [];
        try {
          enriched = await getServicesByIds(fallbackSlice.map((service) => service.id), { mode: "full" });
        } catch (error) {
          registerWarning(
            "Alguns serviços foram carregados parcialmente.",
            error,
            "Falha ao detalhar serviços do pacote",
          );
        }
        if (enriched.length) {
          const byId = new Map(enriched.map((service) => [service.id, service]));
          services = fallbackSlice.map((service) => byId.get(service.id) ?? service);
        } else {
          services = fallbackSlice;
        }
      }
    } catch (error) {
      registerWarning(
        "Não foi possível carregar os serviços vinculados ao pacote.",
        error,
        "Falha ao listar serviços do pacote",
      );
    }
  }

  const assignedCompanies = pkg.assignedCompanies?.filter((item) => item.companyId);
  let folders: PackageFolderWithProgress[] = [];
  let availableOpenServices: Service[] = [];

  const [foldersResult, availableServicesResult] = await Promise.allSettled([
    listPackageFolders(pkg.id),
    listAvailableOpenServices(200, { mode: "summary" }),
  ]);

  if (foldersResult.status === "fulfilled") {
    folders = foldersResult.value;
  } else {
    registerWarning(
      "Não foi possível carregar os subpacotes vinculados a este pacote.",
      foldersResult.reason,
      "Falha ao listar subpacotes do pacote",
    );
  }

  if (availableServicesResult.status === "fulfilled") {
    availableOpenServices = availableServicesResult.value;
  } else {
    registerWarning(
      "Não foi possível carregar os serviços abertos disponíveis para novos subpacotes.",
      availableServicesResult.reason,
      "Falha ao listar serviços disponíveis",
    );
  }

  // A lista do subpacote e a lista legada do pacote podem ficar temporariamente
  // dessincronizadas (principalmente em importações grandes). Os subpacotes são a
  // fonte necessária para esta seção, portanto carregue também qualquer ID que só
  // esteja neles. Sem isso, serviços acima do antigo corte de 100 apareciam apenas
  // com o ID e ficavam fora dos cálculos de progresso, horas e curva S.
  const folderServiceSelection = selectMissingFolderServices(
    folders.map((folder) => folder.services),
    services.map((service) => service.id),
    MAX_SERVICES_TO_LOAD,
  );
  const folderOnlyServiceIds = folderServiceSelection.folderServiceIds.filter(
    (serviceId) => !services.some((service) => service.id === serviceId),
  );
  const folderServiceIdsToFetch = folderServiceSelection.missingServiceIds;
  hasServiceOverflow ||= folderServiceSelection.hasOverflow;

  if (folderServiceIdsToFetch.length) {
    try {
      const folderServices = await getServicesByIds(folderServiceIdsToFetch, { mode: "full" });
      services = [...services, ...folderServices];
      const fetchedFolderIds = new Set(folderServices.map((service) => service.id));
      if (folderServiceIdsToFetch.some((serviceId) => !fetchedFolderIds.has(serviceId))) {
        registerWarning("Alguns serviços dos subpacotes não puderam ser carregados completamente.");
      }
    } catch (error) {
      registerWarning(
        "Não foi possível carregar todos os serviços vinculados aos subpacotes.",
        error,
        "Falha ao buscar serviços exclusivos dos subpacotes",
      );
    }
  }

  const allKnownServiceIds = new Set([...uniqueServiceIds, ...folderOnlyServiceIds]);
  if (allKnownServiceIds.size > serviceCountReference) {
    serviceCountReference = allKnownServiceIds.size;
    serviceCountIsExact = true;
  }

  if (hasServiceOverflow && services.length) {
    const displayedCount = services.length;
    const totalLabel = serviceCountIsExact
      ? `${serviceCountReference} serviço${serviceCountReference === 1 ? "" : "s"}`
      : `mais de ${Math.max(displayedCount, MAX_SERVICES_TO_LOAD)} serviço${
          Math.max(displayedCount, MAX_SERVICES_TO_LOAD) === 1 ? "" : "s"
        }`;
    registerWarning(
      `Este pacote possui ${totalLabel} vinculados. Exibimos apenas ${displayedCount} serviço${
        displayedCount === 1 ? "" : "s"
      } para evitar travamentos. Os dados agregados podem ficar incompletos.`,
    );
  } else if (hasServiceOverflow && services.length === 0) {
    registerWarning(
      "Este pacote possui muitos serviços vinculados. Os detalhes completos não puderam ser exibidos.",
    );
  }

  // `service.updates` pode ser apenas um snapshot legado embutido no documento
  // do serviço. Edições (inclusive da data operacional) são gravadas nas
  // subcoleções, portanto sempre buscamos o histórico canônico antes de montar
  // as curvas e o relatório Excel do pacote.
  if (services.length) {
    const updatesById = new Map<string, Service["updates"]>();
    const chunkSize = 15;

    for (let i = 0; i < services.length; i += chunkSize) {
      const slice = services.slice(i, i + chunkSize);
      const results = await Promise.allSettled(
        slice.map(async (service) => ({
          id: service.id,
          updates: await listUpdates(service.id, 200, service.hasLegacyServiceUpdates),
        })),
      );

      results.forEach((result) => {
        if (result.status === "fulfilled") {
          updatesById.set(result.value.id, result.value.updates);
        } else {
          registerWarning(
            "Alguns históricos de progresso não puderam ser carregados.",
            result.reason,
            "Falha ao carregar histórico de atualizações do serviço",
          );
        }
      });
    }

    if (updatesById.size > 0) {
      services = services.map((service) => {
        const resolvedUpdates = updatesById.get(service.id);
        if (!resolvedUpdates) return service;
        return { ...service, updates: resolvedUpdates };
      });
    }
  }

  const hoursFromServices = Math.round(
    services.reduce((acc, service) => {
      const hours = Number(service.totalHours ?? 0);
      return acc + (Number.isFinite(hours) ? hours : 0);
    }, 0) * 100,
  ) / 100;

  const servicesById = new Map(services.map((service) => [service.id, service]));
  const folderServiceIds = new Set<string>();
  folders.forEach((folder) => {
    folder.services.forEach((serviceId) => {
      if (serviceId) folderServiceIds.add(serviceId);
    });
  });

  const subpackagesForCurve = folders.map((folder) => {
    const servicos = folder.services
      .map((serviceId) => servicesById.get(serviceId))
      .filter((service): service is Service => Boolean(service))
      .map((service) => mapServiceToSubpackageEntry(service));
    return { id: folder.id, nome: folder.name, servicos };
  });

  // Incluir serviços que não estão em subpacotes em um subpacote virtual
  const servicesNotInFolders = services
    .filter((service) => !folderServiceIds.has(service.id))
    .map((service) => mapServiceToSubpackageEntry(service));

  if (servicesNotInFolders.length > 0) {
    subpackagesForCurve.push({
      id: "sem-subpacote",
      nome: "Sem Subpacote",
      servicos: servicesNotInFolders,
    });
  }

  const plannedPercentAtReference = Math.round(
    calcularPercentualPlanejadoPacote({ subpacotes: subpackagesForCurve }, referenceDate),
  );
  const realizedPercentAtReference = Math.round(
    calcularPercentualRealizadoPacote({ subpacotes: subpackagesForCurve }, referenceDate),
  );

  const realizedValueLabel = `${realizedPercentAtReference}%`;
  const realizedHeaderLabel = hasServiceOverflow
    ? `Realizado (parcial): ${realizedValueLabel}`
    : `Realizado: ${realizedValueLabel}`;

  const folderAnalyticsMap = new Map<
    string,
    { plannedPercent: number; realizedPercent: number; startDateMs: number | null; endDateMs: number | null }
  >();
  subpackagesForCurve.forEach((subpacote) => {
    if (!subpacote?.id) return;
    const plannedPercentRaw = calcularPercentualSubpacote(subpacote, referenceDate);
    const realizedPercentRaw = calcularPercentualRealizadoSubpacote(subpacote, referenceDate);
    const plannedPercent = Math.round(plannedPercentRaw);
    const realizedPercent = Math.round(realizedPercentRaw);
    const intervalo = obterIntervaloSubpacote(subpacote);
    folderAnalyticsMap.set(subpacote.id, {
      plannedPercent,
      realizedPercent,
      startDateMs: intervalo.inicio ? intervalo.inicio.getTime() : null,
      endDateMs: intervalo.fim ? intervalo.fim.getTime() : null,
    });
  });
  folders = folders.map((folder) => {
    const analytics = folderAnalyticsMap.get(folder.id);
    return {
      ...folder,
      progressPercent: analytics?.plannedPercent ?? 0,
      realizedPercent: analytics?.realizedPercent ?? null,
      startDateMs: analytics?.startDateMs ?? null,
      endDateMs: analytics?.endDateMs ?? null,
    };
  });

  const folderLookup = new Map<string, { id: string; name?: string | null }>();
  folders.forEach((folder) => {
    folder.services.forEach((serviceId) => {
      if (!serviceId) return;
      folderLookup.set(serviceId, { id: folder.id, name: folder.name });
    });
  });

  const servicesWithFolderContext = services.map((service) => {
    const folderData = folderLookup.get(service.id);
    const directFolderId =
      (typeof (service as { folderId?: unknown }).folderId === "string" &&
        (service as { folderId?: string }).folderId.trim()) ||
      (typeof (service as { pastaId?: unknown }).pastaId === "string" &&
        (service as { pastaId?: string }).pastaId.trim()) ||
      null;

    return {
      ...service,
      folderId: folderData?.id ?? directFolderId,
      pastaId: directFolderId ?? (service as { pastaId?: string | null }).pastaId,
      folderName: folderData?.name ?? null,
    };
  });

  const subpackageMetrics = calcularMetricasSubpacote(servicesWithFolderContext, referenceDate);
  const sectorMetrics = calcularMetricasPorSetor(servicesWithFolderContext, referenceDate);

  const formatPercentValue = (value: number): string => {
    if (!Number.isFinite(value)) return "0";
    const rounded = Math.round(value);
    return String(Object.is(rounded, -0) ? 0 : rounded);
  };

  const formatHoursValue = (value: number): string => {
    if (!Number.isFinite(value)) return "0.00";
    const rounded = Math.round(value * 100) / 100;
    return (Object.is(rounded, -0) ? 0 : rounded).toFixed(2);
  };

  // Services already assigned to this package remain eligible until they are
  // placed in a folder. The global "available" query intentionally only returns
  // unassigned services, so merge both sources before building the picker.
  const assignableServices = new Map<string, Service>();
  [...services, ...availableOpenServices].forEach((service) => {
    const status = resolveDisplayedServiceStatus(service, { referenceDate });
    if ((status === "Aberto" || status === "Pendente") && !folderServiceIds.has(service.id)) {
      assignableServices.set(service.id, service);
    }
  });

  const availableServiceOptions: FolderServiceOption[] = [...assignableServices.values()]
    .map((service) => {
      const baseLabel = service.os || service.oc || service.tag || service.id;
      const descriptionParts: string[] = [];
      const companyLabel = service.empresa || service.company || service.assignedTo?.companyName;
      if (companyLabel) descriptionParts.push(`Empresa: ${companyLabel}`);
      if (service.setor) descriptionParts.push(`Setor: ${service.setor}`);
      const statusLabel = resolveDisplayedServiceStatus(service, { referenceDate });
      return {
        id: service.id,
        label: baseLabel && baseLabel.length ? baseLabel : service.id,
        description: descriptionParts.length ? descriptionParts.join(" • ") : undefined,
        status: statusLabel,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR", { sensitivity: "base" }));

  const serviceDetails: Record<string, FolderServiceInfo> = {};

  services.forEach((service) => {
    const baseLabel = service.os || service.code || service.id;
    const snapshot = buildServiceProgressSnapshot(service, referenceDate);
    const companyLabel =
      service.assignedTo?.companyName ||
      service.assignedTo?.companyId ||
      service.company ||
      service.empresa ||
      assignedCompanies?.find((item) => item.companyId === service.assignedTo?.companyId)?.companyName ||
      assignedCompanies?.find((item) => item.companyName)?.companyName ||
      undefined;
    const statusLabel = resolveDisplayedServiceStatus(service, {
      realizedPercent: snapshot.realizedPercent,
    });
    const lastUpdateMs = resolveServiceLastUpdateMs(service);
    const latestUpdate = getLatestServiceUpdate(service);
    const latestSummary = latestUpdate ? formatUpdateSummary(latestUpdate) : null;

    serviceDetails[service.id] = {
      id: service.id,
      label: companyLabel ? `${baseLabel} — ${companyLabel}` : baseLabel,
      status: statusLabel,
      companyLabel: companyLabel,
      cnpj: service.cnpj ?? null,
      plannedPercent: snapshot.plannedPercent,
      realizedPercent: snapshot.realizedPercent,
      deltaPercent: snapshot.deltaPercent,
      startDateMs: snapshot.startDateMs,
      endDateMs: snapshot.endDateMs,
      isOpen: statusLabel === "Aberto" || statusLabel === "Pendente",
      lastUpdateMs,
      latestUpdateDescription: latestSummary?.description ?? latestUpdate?.description ?? null,
      // O texto vem do último RDO, mas a porcentagem deve usar o mesmo valor
      // consolidado dos cálculos. Assim um snapshot excluído não reaparece no card.
      latestUpdatePercentLabel: latestUpdate
        ? formatCanonicalProgressLabel(snapshot.realizedPercent)
        : null,
    };
  });

  availableOpenServices.forEach((service) => {
    const companyLabel =
      service.empresa || service.company || service.assignedTo?.companyName || service.assignedTo?.companyId || null;
    const snapshot = buildServiceProgressSnapshot(service, referenceDate);
    const lastUpdateMs = resolveServiceLastUpdateMs(service);
    if (serviceDetails[service.id]) {
      if (!serviceDetails[service.id].companyLabel && companyLabel) {
        serviceDetails[service.id] = {
          ...serviceDetails[service.id],
          companyLabel: companyLabel ?? undefined,
          plannedPercent: serviceDetails[service.id].plannedPercent ?? snapshot.plannedPercent,
          realizedPercent: serviceDetails[service.id].realizedPercent ?? snapshot.realizedPercent,
          deltaPercent: serviceDetails[service.id].deltaPercent ?? snapshot.deltaPercent,
          startDateMs: serviceDetails[service.id].startDateMs ?? snapshot.startDateMs,
          endDateMs: serviceDetails[service.id].endDateMs ?? snapshot.endDateMs,
          lastUpdateMs: serviceDetails[service.id].lastUpdateMs ?? lastUpdateMs,
        };
      }
      return;
    }
    const baseLabel = service.os || service.oc || service.tag || service.id;
    const statusLabel = resolveDisplayedServiceStatus(service, {
      realizedPercent: snapshot.realizedPercent,
    });
    const latestUpdate = getLatestServiceUpdate(service);
    const latestSummary = latestUpdate ? formatUpdateSummary(latestUpdate) : null;

    serviceDetails[service.id] = {
      id: service.id,
      label: companyLabel ? `${baseLabel} — ${companyLabel}` : baseLabel,
      status: statusLabel,
      companyLabel: companyLabel ?? undefined,
      cnpj: service.cnpj ?? null,
      plannedPercent: snapshot.plannedPercent,
      realizedPercent: snapshot.realizedPercent,
      deltaPercent: snapshot.deltaPercent,
      startDateMs: snapshot.startDateMs,
      endDateMs: snapshot.endDateMs,
      isOpen: statusLabel === "Aberto" || statusLabel === "Pendente",
      lastUpdateMs,
      latestUpdateDescription: latestSummary?.description ?? latestUpdate?.description ?? null,
      latestUpdatePercentLabel: latestUpdate
        ? formatCanonicalProgressLabel(snapshot.realizedPercent)
        : null,
    };
  });

  folders.forEach((folder) => {
    folder.services.forEach((serviceId) => {
      if (!serviceId || serviceDetails[serviceId]) return;
      serviceDetails[serviceId] = {
        id: serviceId,
        label: serviceId,
        status: "Desconhecido",
        companyLabel: folder.companyId ?? undefined,
        isOpen: false,
      };
    });
  });

  const warningMessages = Array.from(warningSet);
  const encodedPackageId = encodeURIComponent(pkg.id);
  const packageLabel = pkg.name || pkg.code || pkg.id;
  const excelRows = services.map((service) => {
    const snapshot = buildServiceProgressSnapshot(service, referenceDate);
    return {
      os: service.os || service.code || "",
      tag: service.tag || "",
      equipment:
        service.equipmentName ||
        (typeof (service as Record<string, unknown>).equipamento === "string"
          ? String((service as Record<string, unknown>).equipamento)
          : ""),
      description:
        service.description ||
        (typeof (service as Record<string, unknown>).descricao === "string"
          ? String((service as Record<string, unknown>).descricao)
          : ""),
      progress: snapshot.realizedPercent,
      company:
        service.empresa ||
        service.company ||
        service.assignedTo?.companyName ||
        service.assignedTo?.companyId ||
        "",
      startDate: formatDisplayDate(snapshot.startDateMs, {
        timeZone: "America/Sao_Paulo",
        fallback: "-",
      }),
      endDate: formatDisplayDate(snapshot.endDateMs, {
        timeZone: "America/Sao_Paulo",
        fallback: "-",
      }),
      totalHours: formatHoursValue(resolveServiceHours(service)),
      oc: service.oc || "",
      dailyUpdates: (service.updates ?? [])
        .slice()
        .sort((left, right) => {
          const leftDate = left.date ?? left.submittedAt ?? left.createdAt ?? 0;
          const rightDate = right.date ?? right.submittedAt ?? right.createdAt ?? 0;
          return leftDate - rightDate;
        })
        .map((update) => ({
          date: formatDisplayDate(update.date ?? update.submittedAt ?? update.createdAt, {
            timeZone: "America/Sao_Paulo",
            fallback: "-",
          }),
          description: update.description || "-",
        })),
    };
  });
  const statusLabel = normaliseServiceStatus(pkg.status);
  const statusTone = PACKAGE_STATUS_TONE[statusLabel] ?? "border-border bg-muted text-foreground/80";
  const plannedStartLabel = formatDate(pkg.plannedStart);
  const plannedEndLabel = formatDate(pkg.plannedEnd);
  const resolvedTotalHours = hasServiceOverflow
    ? pkg.totalHours ?? hoursFromServices
    : hoursFromServices || pkg.totalHours;
  const totalHoursLabel = Number.isFinite(resolvedTotalHours ?? NaN)
    ? formatHoursValue(Number(resolvedTotalHours))
    : "-";
  const totalServicesLabel = serviceCountReference
    ? serviceCountIsExact
      ? `${serviceCountReference} serviço${serviceCountReference === 1 ? "" : "s"}`
      : `Mais de ${Math.max(serviceCountReference, services.length)} serviços`
    : `${services.length} serviço${services.length === 1 ? "" : "s"}`;

  const rawPlannedCurve = calcularCurvaSPlanejada({ subpacotes: subpackagesForCurve }).map(
    (point) => ({
      date: point.data.toISOString().slice(0, 10),
      percent: Math.round(point.percentual),
    }),
  );

  const rawRealizedCurve = calcularCurvaSRealizada({ subpacotes: subpackagesForCurve }).map(
    (point) => ({
      date: point.data.toISOString().slice(0, 10),
      percent: Math.round(point.percentual),
    }),
  );

  const plannedCurve = limitCurveDatesToPackageRange(rawPlannedCurve, pkg.plannedStart, pkg.plannedEnd);
  const realizedCurve = limitCurveDatesToPackageRange(rawRealizedCurve, pkg.plannedStart, pkg.plannedEnd, {
    includeEndPoint: false,
  });

  return (
    <div className="container mx-auto max-w-7xl space-y-6 px-6 py-6 package-print-layout print:m-0 print:w-full print:max-w-none print:space-y-3 print:px-0 print:py-0">
      <div className="print-summary-and-curve space-y-6 print:space-y-3">
        <section className="package-header rounded-2xl border bg-card/80 p-5 shadow-sm print-card print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none print:px-2 print:py-3">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between print:block print:gap-1.5">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusTone}`}>
                  {statusLabel}
                </span>
                <span className="rounded-full border border-transparent bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
                  {realizedHeaderLabel}
                </span>
              </div>
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold tracking-tight">{packageLabel}</h1>
                <p className="text-sm text-muted-foreground">
                  Resumo do pacote e serviços vinculados.
                </p>
                <div className="mt-3 max-w-md">
                  <PackageReferenceDateSelector initialValue={referenceDateInput} />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 md:justify-end print:hidden">
              <Link className="btn btn-secondary" href="/pacotes">
                Voltar
              </Link>
              <Link className="btn btn-secondary" href={`/pacotes/${encodedPackageId}/fotos`}>
                Ver fotos
              </Link>
              <Link className="btn btn-primary" href={`/pacotes/${encodedPackageId}/editar`}>
                Editar
              </Link>
              <PackageImportServicesButton packageId={pkg.id} />
              <PackageExcelExportButton packageLabel={packageLabel} rows={excelRows} />
              <PackagePdfExportButton />
              <DeletePackageButton packageId={pkg.id} packageLabel={packageLabel} />
            </div>
          </div>

          <div className="mt-4 rounded-2xl border border-dashed border-border/70 bg-muted/20 p-4 print:mt-2 print:w-full print:rounded-none print:border-0 print:bg-white print:p-1.5">
            <div className="flex flex-wrap items-start justify-between gap-4 print:block print:w-full print:gap-1.5">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">
                  Planejado: <span className="font-semibold text-foreground">{plannedPercentAtReference}%</span> | Real:
                  <span className="font-semibold text-foreground"> {realizedPercentAtReference}%</span>
                </p>
              </div>
            </div>
          </div>

          <dl className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 summary-grid print:mt-2 print:w-full print:grid-cols-2 print:gap-2">
            <div className="space-y-1 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 print:border-0 print:bg-white print:rounded-none print:p-1.5">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Início planejado</dt>
              <dd className="text-base font-semibold text-foreground">{plannedStartLabel}</dd>
            </div>
            <div className="space-y-1 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 print:border-0 print:bg-white print:rounded-none print:p-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Fim planejado</dt>
              <dd className="text-base font-semibold text-foreground">{plannedEndLabel}</dd>
            </div>
            <div className="space-y-1 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 print:border-0 print:bg-white print:rounded-none print:p-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Serviços vinculados</dt>
              <dd className="text-base font-semibold text-foreground">{totalServicesLabel}</dd>
            </div>
            <div className="space-y-1 rounded-xl border border-dashed border-border/70 bg-muted/20 p-4 print:border-0 print:bg-white print:rounded-none print:p-2">
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Horas totais</dt>
              <dd className="text-base font-semibold text-foreground">{totalHoursLabel}</dd>
            </div>
          </dl>
        </section>

        <PackageSCurveSection packageId={pkg.id} planned={plannedCurve} realized={realizedCurve} />

        {warningMessages.length ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900 shadow-sm print:hidden">
            <p className="font-medium">Nem todas as informações foram carregadas.</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {warningMessages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </div>
        ) : null}

      </div>

      <section className="summary-blocks print-summary-blocks mt-8 rounded-2xl border bg-card/80 p-5 shadow-sm space-y-8 print:mt-4 print:space-y-4 print-no-border print:w-full print:rounded-none print:border-0 print:bg-white print:shadow-none print:p-2 print-no-radius print-full-width">
        <div className="summary-block-item space-y-3 print-keep-with-next print:space-y-2">
          <h2 className="text-lg font-semibold print:text-base print:mb-1">Resumo por Subpacote</h2>
          {subpackageMetrics.length ? (
            <div className="summary-table-wrapper overflow-x-auto rounded-xl border bg-card print:overflow-visible print:border-0 print:bg-white print:rounded-none print-full-width">
              <table className="summary-table mt-2 min-w-full border-collapse text-center print-plain-table print:mt-0">
                <thead className="bg-muted/80 text-foreground print:bg-white">
                  <tr>
                    <th className="border border-border p-3 print:p-2 text-left">Subpacote</th>
                    <th className="border border-border p-3 print:p-2">% Atual</th>
                    <th className="border border-border p-3 print:p-2">% Deveria Estar</th>
                    <th className="border border-border p-3 print:p-2">Total de Horas</th>
                    <th className="border border-border p-3 print:p-2">Horas que Deveriam Estar</th>
                    <th className="border border-border p-3 print:p-2">Horas atual</th>
                    <th className="border border-border p-3 print:p-2">Diferença</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {subpackageMetrics.map((metric) => (
                    <tr key={metric.nome} className="odd:bg-muted/40 print:bg-white">
                      <td className="border border-border p-3 print:p-2 text-left font-medium">{metric.nome}</td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatPercentValue(metric.realizedPercent)}%
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatPercentValue(metric.plannedPercent)}%
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.totalHours)}
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.horasQueDeveriamEstar)}
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.horasAtual)}
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.diferenca)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Não há subpacotes cadastrados para este pacote.
            </p>
          )}
        </div>

        <div className="summary-block-item space-y-3 print-keep-with-next print:space-y-2">
          <h2 className="text-lg font-semibold print:text-base print:mb-1">Resumo por Setor</h2>
          {sectorMetrics.length ? (
            <div className="summary-table-wrapper overflow-x-auto rounded-xl border bg-card print:overflow-visible print:border-0 print:bg-white print:rounded-none print-full-width">
              <table className="summary-table mt-2 min-w-full border-collapse text-center print-plain-table print:mt-0">
                <thead className="bg-muted/80 text-foreground print:bg-white">
                  <tr>
                    <th className="border border-border p-3 print:p-2 text-left">Setor</th>
                    <th className="border border-border p-3 print:p-2">% Atual</th>
                    <th className="border border-border p-3 print:p-2">% Deveria Estar</th>
                    <th className="border border-border p-3 print:p-2">Total de Horas</th>
                    <th className="border border-border p-3 print:p-2">Horas que Deveriam Estar</th>
                    <th className="border border-border p-3 print:p-2">Horas atual</th>
                    <th className="border border-border p-3 print:p-2">Diferença</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  {sectorMetrics.map((metric) => (
                    <tr key={metric.setor} className="odd:bg-muted/40 print:bg-white">
                      <td className="border border-border p-3 print:p-2 text-left font-medium">{metric.setor}</td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatPercentValue(metric.realizedPercent)}%
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatPercentValue(metric.plannedPercent)}%
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.totalHours)}
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.horasQueDeveriamEstar)}
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.horasAtual)}
                      </td>
                      <td className="border border-border p-3 print:p-2 font-semibold">
                        {formatHoursValue(metric.diferenca)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Não há setores cadastrados para este pacote.
            </p>
          )}
        </div>
      </section>

      <div className="space-y-6">
        <div className="space-y-6 print:hidden">
          <PackageFoldersManagerClient
            packageId={pkg.id}
            services={availableServiceOptions}
            serviceDetails={serviceDetails}
            initialFolders={folders}
          />

          <ServicesCompaniesSection packageId={pkg.id} folders={folders} serviceDetails={serviceDetails} />
        </div>

        <div className="hidden print:block print-page-break-before print:px-2 print:pt-2" aria-hidden>
          <ServicesCompaniesSection
            packageId={pkg.id}
            folders={folders}
            serviceDetails={serviceDetails}
            forceExpandAll
            printLayout
          />
        </div>
      </div>

   </div>
  );
}

function isRedirectDigestError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const possible = error as { digest?: unknown };
  return typeof possible.digest === "string" && possible.digest.startsWith("NEXT_REDIRECT");
}

function isNotFoundLikeError(error: unknown): boolean {
  if (typeof (Navigation as { isNotFoundError?: unknown }).isNotFoundError === "function") {
    if ((Navigation as { isNotFoundError: (error: unknown) => boolean }).isNotFoundError(error)) {
      return true;
    }
  }

  if (!error || typeof error !== "object") return false;
  const digest = (error as { digest?: unknown }).digest;
  if (typeof digest === "string") {
    return digest === "NEXT_NOT_FOUND" || digest.startsWith("NEXT_NOT_FOUND");
  }
  return false;
}

export default async function PackageDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: Record<string, string | string[] | undefined>;
}) {
  try {
    return await renderPackageDetailPage(params, searchParams);
  } catch (error) {
    if (isNotFoundLikeError(error) || isRedirectDigestError(error)) {
      throw error;
    }

    const rawPackageId = params?.id ?? "";
    const decodedPackageId = decodeRouteParam(rawPackageId);
    const displayPackageId = decodedPackageId && decodedPackageId.length > 0 ? decodedPackageId : rawPackageId || "-";

    console.error(
      `[PackageDetailPage:${rawPackageId || "unknown"}] Erro inesperado ao renderizar os detalhes do pacote.`,
      error,
    );

    return renderPackageLoadFailure(displayPackageId, [
      "Ocorreu um erro inesperado ao carregar os detalhes do pacote.",
      "Verifique as credenciais do Firebase e tente novamente.",
    ]);
  }
}
