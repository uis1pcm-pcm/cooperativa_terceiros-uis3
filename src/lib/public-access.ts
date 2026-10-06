import type { FirebaseFirestore } from "firebase-admin/firestore";

import type { ChecklistItem, Service, ServiceStatus } from "@/lib/types";
import { getAdmin } from "@/lib/firebaseAdmin";
import { collectFolderServiceIds, type FolderServiceSource } from "@/lib/folderServices";

type AccessTokenData = FirebaseFirestore.DocumentData & {
  targetType?: string;
  targetId?: string;
  company?: string;
  companyId?: string;
  revoked?: boolean;
  active?: boolean;
  expiresAt?: unknown;
  packageId?: string;
  pacoteId?: string;
  folderId?: string;
  pastaId?: string;
  oneTime?: boolean;
};

type FolderDoc = FirebaseFirestore.DocumentData &
  FolderServiceSource & {
  services?: string[];
  serviceIds?: string[];
  servicos?: string[];
  companyId?: string;
  company?: string;
  pastaId?: string;
  folderId?: string;
  packageId?: string;
  pacoteId?: string;
};

const accessTokensCollection = () =>
  getAdmin().db.collection("accessTokens") as FirebaseFirestore.CollectionReference<AccessTokenData>;
const servicesCollection = () =>
  getAdmin().db.collection("services") as FirebaseFirestore.CollectionReference<FirebaseFirestore.DocumentData>;
const foldersCollection = () =>
  getAdmin().db.collection("packageFolders") as FirebaseFirestore.CollectionReference<FolderDoc>;

export class PublicAccessError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type FirestoreTimestamp = { toMillis?: () => number } | null | undefined;

function toMillis(value: unknown | FirestoreTimestamp): number | undefined {
  if (typeof value === "number") return value;
  if (!value) return undefined;
  const maybeTimestamp = value as FirestoreTimestamp;
  const millis = maybeTimestamp?.toMillis?.();
  if (typeof millis === "number" && Number.isFinite(millis)) return millis;
  return undefined;
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function resolveProgressFromDoc(data: FirebaseFirestore.DocumentData): number {
  const record = data as Record<string, unknown>;
  const statusValue = record.displayStatus ?? data.status;
  const statusRaw = typeof statusValue === "string" ? statusValue.trim().toLowerCase() : "";
  const previousProgress = [
    (data as Record<string, unknown>).previousProgress,
    (data as Record<string, unknown>).progressBeforeConclusion,
    (data as Record<string, unknown>).previousPercent,
  ]
    .map((value) => toNumber(value))
    .find((value): value is number => typeof value === "number" && Number.isFinite(value));

  const canonicalProgress = [
    data.andamento,
    record.percentualRealAtual,
    record.realPercentSnapshot,
    data.realPercent,
    data.progress,
    record.percent,
  ]
    .map((value) => toNumber(value))
    .find((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (
    statusRaw === "pendente" &&
    typeof previousProgress === "number" &&
    (canonicalProgress === undefined || canonicalProgress >= 100)
  ) {
    const clamped = Math.min(100, Math.max(0, Math.round(previousProgress)));
    if (clamped < 100) {
      return clamped;
    }
  }

  const progressCandidates = [
    data.andamento,
    record.percentualRealAtual,
    record.realPercentSnapshot,
    data.realPercent,
    data.progress,
    record.percent,
    previousProgress,
  ];

  for (const candidate of progressCandidates) {
    const numeric = toNumber(candidate);
    if (typeof numeric === "number" && Number.isFinite(numeric)) {
      return Math.min(100, Math.max(0, Math.round(numeric)));
    }
  }

  return 0;
}

function getTokenCompany(token: AccessTokenData): string | undefined {
  if (typeof token.companyId === "string" && token.companyId.trim()) return token.companyId.trim();
  if (typeof token.company === "string" && token.company.trim()) return token.company.trim();
  return undefined;
}

async function fetchToken(tokenId: string): Promise<AccessTokenData> {
  const snap = await accessTokensCollection().doc(tokenId).get();
  if (!snap.exists) {
    throw new PublicAccessError(403, "Token inválido");
  }

  const data = snap.data() ?? ({} as AccessTokenData);
  if (data.revoked === true || data.active === false) {
    throw new PublicAccessError(403, "Token inativo");
  }

  const expiresAt = toMillis(data.expiresAt as unknown);
  if (expiresAt && expiresAt < Date.now()) {
    throw new PublicAccessError(403, "Token expirado");
  }

  const record = data as Record<string, unknown>;
  let targetType = typeof data.targetType === "string" ? data.targetType : undefined;
  const targetId = typeof data.targetId === "string" ? data.targetId : undefined;
  const packageId =
    (typeof data.packageId === "string" && data.packageId.trim()) ||
    (typeof data.pacoteId === "string" && data.pacoteId.trim()) ||
    undefined;
  const folderId =
    (typeof record.folderId === "string" && record.folderId.trim()) ||
    (typeof record.pastaId === "string" && record.pastaId.trim()) ||
    (targetType === "folder" && typeof targetId === "string" ? targetId : undefined) ||
    undefined;

  // Se targetType não está definido, mas temos folderId, inferir que é "folder"
  if (!targetType && folderId) {
    targetType = "folder";
  }
  // Se targetType não está definido, mas temos serviceId, inferir que é "service"
  if (!targetType && (typeof record.serviceId === "string" || targetId)) {
    targetType = "service";
  }

  return {
    ...data,
    targetType,
    targetId,
    packageId,
    folderId,
  };
}

function normalizeCompany(data: FirebaseFirestore.DocumentData): string | undefined {
  const candidates = [
    data.company,
    data.companyId,
    (data as Record<string, unknown>).empresa,
    (data as Record<string, unknown>).empresaId,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }

  return undefined;
}

function mapServiceDoc(doc: FirebaseFirestore.DocumentSnapshot): Service {
  const data = doc.data() ?? {};
  const record = data as Record<string, unknown>;
  const totalHoursCandidate =
    toNumber(data.totalHours) ??
    toNumber(record.totalHoras) ??
    toNumber(record.horasTotais) ??
    toNumber(record.horasPrevistas) ??
    toNumber(record.hours) ??
    0;

  const equipmentName =
    (typeof data.equipmentName === "string" && data.equipmentName.trim())
      ? data.equipmentName.trim()
      : (typeof record.equipamento === "string" && record.equipamento.trim())
        ? record.equipamento.trim()
        : "";

  const sector =
    (typeof data.sector === "string" && data.sector.trim())
      ? data.sector.trim()
      : (typeof record.setor === "string" && record.setor.trim())
        ? record.setor.trim()
        : "";

  const description =
    (typeof data.description === "string" && data.description.trim())
      ? data.description.trim()
      : (typeof record.descricao === "string" && record.descricao.trim())
        ? record.descricao.trim()
        : undefined;

  const plannedStart =
    data.plannedStart ??
    record.inicioPrevisto ??
    record.inicioPlanejado ??
    record.dataInicio ??
    record.startDate ??
    "";

  const plannedEnd =
    data.plannedEnd ??
    record.fimPrevisto ??
    record.fimPlanejado ??
    record.dataFim ??
    record.endDate ??
    "";

  const resolvedProgress = resolveProgressFromDoc(data);
  const resolvedStatus = (record.displayStatus ?? data.status ?? "aberto") as ServiceStatus;

  return {
    id: doc.id,
    os: data.os ?? "",
    oc: data.oc ?? undefined,
    tag: data.tag ?? "",
    equipmentName,
    setor: typeof record.setor === "string" ? record.setor : undefined,
    sector,
    plannedStart,
    plannedEnd,
    totalHours: totalHoursCandidate,
    description,
    status: resolvedStatus,
    displayStatus: resolvedStatus,
    company: normalizeCompany(data),
    empresa: typeof record.empresa === "string" ? record.empresa : typeof record.empresaId === "string" ? record.empresaId : undefined,
    cnpj: typeof data.cnpj === "string" ? data.cnpj.trim() || null : undefined,
    createdAt: toMillis(data.createdAt),
    updatedAt: toMillis(data.updatedAt),
    lastUpdateDate: toMillis(record.lastUpdateDate) ?? undefined,
    lastProgressUpdateAt: toMillis(record.lastProgressUpdateAt) ?? undefined,
    hasChecklist: data.hasChecklist ?? false,
    progress: resolvedProgress,
    andamento: resolvedProgress,
    realPercent: resolvedProgress,
    realPercentSnapshot: toNumber(record.realPercentSnapshot),
    percentualRealAtual: toNumber(record.percentualRealAtual),
    manualPercent: toNumber(record.manualPercent),
    previousProgress:
      toNumber(record.previousProgress ?? record.progressBeforeConclusion ?? record.previousPercent) ?? null,
    packageId: data.packageId ?? record.pacoteId ?? undefined,
  };
}

function isServiceOpen(data: FirebaseFirestore.DocumentData): boolean {
  const progress = resolveProgressFromDoc(data);
  if (progress >= 100) return false;

  const statusRaw = typeof data.status === "string" ? data.status.trim().toLowerCase() : "";
  const statusNormalised = statusRaw || "aberto";

  if (statusNormalised === "pendente") return true;
  if (statusNormalised === "aberto" || statusNormalised === "aberta" || statusNormalised === "open") {
    return resolveProgressFromDoc(data) < 100;
  }

  const closedKeywords = ["conclu", "encerr", "fechad", "finaliz", "cancel"];
  if (closedKeywords.some((keyword) => statusNormalised.includes(keyword))) return false;

  return resolveProgressFromDoc(data) < 100;
}

function ensureCompanyMatch(token: AccessTokenData, data: FirebaseFirestore.DocumentData) {
  const tokenCompanyRaw = getTokenCompany(token)?.trim();
  const tokenCompany = tokenCompanyRaw?.toLowerCase();
  if (!tokenCompany) return;
  const tokenCompanyDigits = tokenCompany.replace(/\D+/g, "");

  const serviceCompanies = new Set<string>();
  const normalizedCompany = normalizeCompany(data)?.toLowerCase();
  if (normalizedCompany) serviceCompanies.add(normalizedCompany);
  const cnpj = typeof data.cnpj === "string" ? data.cnpj.trim().toLowerCase() : "";
  if (cnpj) serviceCompanies.add(cnpj);
  const serviceCompanyDigits = Array.from(serviceCompanies)
    .map((value) => value.replace(/\D+/g, ""))
    .filter((value) => value.length > 0);

  const directMatch = serviceCompanies.has(tokenCompany);
  const digitMatch = tokenCompanyDigits.length > 0 && serviceCompanyDigits.includes(tokenCompanyDigits);

  if (serviceCompanies.size > 0 && !directMatch && !digitMatch) {
    throw new PublicAccessError(403, "Token não possui acesso a este serviço");
  }
}

function extractFolderId(token: AccessTokenData): string | undefined {
  if (typeof token.folderId === "string" && token.folderId.trim()) return token.folderId.trim();
  if (typeof token.pastaId === "string" && token.pastaId.trim()) return token.pastaId.trim();
  if (token.targetType === "folder" && typeof token.targetId === "string" && token.targetId.trim()) {
    return token.targetId.trim();
  }
  return undefined;
}

type FolderAccessResult = {
  token: AccessTokenData;
  folder: {
    id: string;
    name: string | null;
    company: string | null;
    packageId?: string;
    services: string[];
  };
  services: Service[];
  unavailableServices: string[];
};

function ensureFolderMatchesToken(token: AccessTokenData, folder: FolderDoc, folderId: string) {
  const tokenCompany = getTokenCompany(token)?.toLowerCase();
  const folderCompany =
    (typeof folder.companyId === "string" && folder.companyId.trim().toLowerCase()) ||
    (typeof folder.company === "string" && folder.company.trim().toLowerCase()) ||
    undefined;

  if (tokenCompany && folderCompany && tokenCompany !== folderCompany) {
    throw new PublicAccessError(403, "Token não possui acesso a esta pasta");
  }

  const packageId =
    (typeof folder.packageId === "string" && folder.packageId.trim()) ||
    (typeof folder.pacoteId === "string" && folder.pacoteId.trim()) ||
    undefined;

  if (packageId && typeof token.packageId === "string" && token.packageId.trim()) {
    if (token.packageId.trim() !== packageId) {
      throw new PublicAccessError(403, "Token não corresponde ao pacote do subpacote");
    }
  }

  if (packageId && typeof token.pacoteId === "string" && token.pacoteId.trim()) {
    if (token.pacoteId.trim() !== packageId) {
      throw new PublicAccessError(403, "Token não corresponde ao pacote do subpacote");
    }
  }

  const services = collectFolderServiceIds(folder);

  return { tokenCompany, folderCompany, packageId, services, folderId };
}

async function fetchFolderServicesForToken(
  token: AccessTokenData,
  folderContext: ReturnType<typeof ensureFolderMatchesToken>,
): Promise<{ services: Service[]; unavailable: string[] }> {
  const unavailable: string[] = [];
  const tokenCompany = getTokenCompany(token)?.toLowerCase();

  const promises = folderContext.services.map(async (serviceId) => {
    try {
      const snap = await servicesCollection().doc(serviceId).get();
      if (!snap.exists) {
        console.warn(`[public-access] Serviço ${serviceId} não encontrado no Firestore`);
        unavailable.push(serviceId);
        return null;
      }

      const data = snap.data() ?? {};
      // Se o serviço está na lista do subpacote, ele deve ser exibido
      // independentemente do status, progresso ou packageId, pois foi explicitamente vinculado
      // Também não validamos empresa aqui, pois o serviço foi explicitamente vinculado ao subpacote
      const service = mapServiceDoc(snap);

      return service;
    } catch (error) {
      console.warn(
        `[public-access] Falha ao carregar serviço ${serviceId} do subpacote ${folderContext.folderId}`,
        error,
      );
      unavailable.push(serviceId);
      return null;
    }
  });

  const resolved = await Promise.all(promises);
  const services = resolved.filter((service): service is Service => Boolean(service));

  return { services, unavailable };
}

export async function requireFolderAccess(tokenId: string, folderId: string): Promise<FolderAccessResult> {
  if (!tokenId) throw new PublicAccessError(400, "Token ausente");
  if (!folderId) throw new PublicAccessError(400, "folderId ausente");

  const trimmedFolderId = folderId.trim();
  const token = await fetchToken(tokenId);

  if (token.targetType !== "folder") {
    throw new PublicAccessError(403, "Token não corresponde a um subpacote");
  }

  const expectedFolderId = extractFolderId(token);
  if (expectedFolderId && expectedFolderId !== trimmedFolderId) {
    console.warn(
      `[public-access] Token espera folderId=${expectedFolderId}, mas recebeu ${trimmedFolderId}`,
    );
    throw new PublicAccessError(403, "Token não possui acesso a este subpacote");
  }

  const effectiveFolderId = expectedFolderId ?? trimmedFolderId;
  const snap = await foldersCollection().doc(effectiveFolderId).get();
  if (!snap.exists) {
    console.warn(`[public-access] Subpacote ${effectiveFolderId} não encontrado`);
    throw new PublicAccessError(404, "Subpacote não encontrado");
  }

  const folderData = (snap.data() ?? {}) as FolderDoc;

  const context = ensureFolderMatchesToken(token, folderData, snap.id);

  const { services, unavailable } = await fetchFolderServicesForToken(token, context);

  if (unavailable.length > 0) {
    console.warn(
      `[public-access] Serviços do subpacote ${snap.id} filtrados por indisponibilidade: ${unavailable.join(", ")}`,
    );
  }

  const folderName = typeof folderData.name === "string" ? folderData.name.trim() : "";
  const companyLabel =
    (typeof folderData.company === "string" && folderData.company.trim()) ||
    (typeof folderData.companyId === "string" && folderData.companyId.trim()) ||
    null;

  return {
    token,
    folder: {
      id: snap.id,
      name: folderName || null,
      company: companyLabel,
      packageId: context.packageId,
      services: context.services,
    },
    services,
    unavailableServices: unavailable,
  };
}

async function ensureServiceAllowedByFolder(token: AccessTokenData, serviceId: string) {
  const folderId = extractFolderId(token);
  if (!folderId) {
    throw new PublicAccessError(403, "Token não corresponde à pasta");
  }

  const snap = await foldersCollection().doc(folderId).get();
  if (!snap.exists) {
    throw new PublicAccessError(403, "Pasta não encontrada para este token");
  }

  const data = snap.data() ?? ({} as FolderDoc);
  const services = collectFolderServiceIds(data);

  if (!services.includes(serviceId)) {
    throw new PublicAccessError(403, "Serviço não faz parte desta pasta");
  }

  const tokenCompany = getTokenCompany(token)?.toLowerCase();
  const folderCompany =
    typeof data.companyId === "string" && data.companyId.trim()
      ? data.companyId.trim().toLowerCase()
      : typeof data.company === "string" && data.company.trim()
        ? data.company.trim().toLowerCase()
        : undefined;
  if (tokenCompany && folderCompany && tokenCompany !== folderCompany) {
    throw new PublicAccessError(403, "Token não possui acesso a esta pasta");
  }

  const packageId =
    (typeof data.packageId === "string" && data.packageId.trim()) ||
    (typeof data.pacoteId === "string" && data.pacoteId.trim()) ||
    undefined;

  return { folderId, packageId };
}

export async function requireServiceAccess(
  tokenId: string,
  serviceId: string,
  preloadedToken?: AccessTokenData,
): Promise<{
  token: AccessTokenData;
  service: Service;
  folderId?: string;
}> {
  if (!tokenId) throw new PublicAccessError(400, "Token ausente");
  if (!serviceId) throw new PublicAccessError(400, "serviceId ausente");

  const token = preloadedToken ?? await fetchToken(tokenId);
  let folderContext: { folderId: string; packageId?: string } | null = null;

  if (token.targetType === "service") {
    if (token.targetId !== serviceId) {
      throw new PublicAccessError(403, "Token não corresponde ao serviço");
    }
  } else if (token.targetType === "folder") {
    folderContext = await ensureServiceAllowedByFolder(token, serviceId);
  } else {
    throw new PublicAccessError(403, "Token não corresponde ao serviço");
  }

  const snap = await servicesCollection().doc(serviceId).get();
  if (!snap.exists) {
    throw new PublicAccessError(404, "Serviço não encontrado");
  }

  const data = snap.data() ?? {};
  // Para tokens de subpacote, a autorização já foi feita pela associação explícita
  // do serviço com a pasta. Revalidar empresa no serviço bloqueia casos legados em
  // que a empresa foi gravada de forma diferente, apesar do serviço aparecer no subpacote.
  if (!folderContext) {
    ensureCompanyMatch(token, data);
  }

  // Se o serviço está na lista do subpacote (verificado em ensureServiceAllowedByFolder),
  // ele deve ser acessível independentemente do packageId
  const service = mapServiceDoc(snap);
  return { token, service, folderId: folderContext?.folderId };
}

export async function fetchServiceChecklist(serviceId: string): Promise<ChecklistItem[]> {
  const col = servicesCollection().doc(serviceId).collection("checklist");
  const snap = await col.orderBy("description", "asc").get();
  return snap.docs.map((doc) => {
    const data = doc.data() ?? {};
    return {
      id: doc.id,
      serviceId,
      description: data.description ?? "",
      weight: data.weight ?? 0,
      progress: data.progress ?? 0,
      status: (data.status ?? "nao_iniciado") as ChecklistItem["status"],
      updatedAt: toMillis(data.updatedAt),
    };
  });
}

export async function resolvePublicAccessRedirect(tokenId: string): Promise<{
  redirectPath: string;
  targetType: "service" | "folder";
  targetId: string;
}> {
  if (!tokenId) throw new PublicAccessError(400, "Token ausente");

  const token = await fetchToken(tokenId);
  const targetId = token.targetId?.trim();

  if (!targetId) {
    throw new PublicAccessError(400, "Token sem destino configurado");
  }

  if (token.targetType === "service") {
    const { service } = await requireServiceAccess(tokenId, targetId, token);
    return {
      redirectPath: `/s/${service.id}`,
      targetType: "service",
      targetId: service.id,
    };
  }

  if (token.targetType === "folder") {
    const folderId = extractFolderId(token) ?? targetId;
    if (!folderId) {
      throw new PublicAccessError(400, "Token sem pasta configurada");
    }
    const snap = await foldersCollection().doc(folderId).get();
    if (!snap.exists) {
      throw new PublicAccessError(404, "Pasta não encontrada");
    }
    return {
      redirectPath: `/subpacotes/${folderId}`,
      targetType: "folder",
      targetId: folderId,
    };
  }

  throw new PublicAccessError(400, "Token sem destino configurado");
}
