import * as admin from "firebase-admin";
import * as functions from "firebase-functions/v1";
import { Timestamp } from "firebase-admin/firestore";
import type { Request, Response } from "express";

if (!admin.apps.length) admin.initializeApp();
const REGION = "southamerica-east1";

function resolveCanonicalStatus(
  data: FirebaseFirestore.DocumentData,
  progress: number,
  statusOverride?: unknown,
): "Aberto" | "Pendente" | "Concluído" {
  const rawStatus = String(statusOverride ?? data.status ?? "").trim().toLowerCase();
  const previous = [data.previousProgress, data.progressBeforeConclusion, data.previousPercent]
    .map((value) => {
      if (value === null || value === undefined || value === "") return null;
      const parsed = Number(String(value).replace(/%$/, "").replace(",", "."));
      return Number.isFinite(parsed) ? parsed : null;
    })
    .find((value): value is number => value !== null);

  if (rawStatus === "pendente" && previous !== undefined && Math.max(0, Math.min(100, previous)) < 100) {
    return "Pendente";
  }
  if (
    progress >= 100 ||
    rawStatus === "concluido" ||
    rawStatus === "concluído" ||
    rawStatus === "encerrado"
  ) {
    return "Concluído";
  }
  return rawStatus === "pendente" ? "Pendente" : "Aberto";
}

type TimestampLike = Timestamp | Date | { toMillis?: () => number } | number | string | null | undefined;

const PORTUGUESE_MONTHS: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function normaliseMonthToken(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

function parseDayFirstDateStringToUtcDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const month = Number(monthRaw);
  const year =
    yearRaw.length === 2
      ? (Number(yearRaw) < 50 ? 2000 + Number(yearRaw) : 1900 + Number(yearRaw))
      : Number(yearRaw);

  if (!Number.isFinite(day) || !Number.isFinite(month) || !Number.isFinite(year)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;

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

function parsePortugueseDateStringToUtcDate(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = trimmed.match(/(\d{1,2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})/i);
  if (!match) return null;

  const [, dayRaw, monthRaw, yearRaw] = match;
  const day = Number(dayRaw);
  const year = Number(yearRaw);
  const month = PORTUGUESE_MONTHS[normaliseMonthToken(monthRaw)];

  if (!Number.isFinite(day) || !Number.isFinite(year)) return null;
  if (!month) return null;
  if (day < 1 || day > 31) return null;

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

function asTimestamp(value: TimestampLike): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (!value) return null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const numeric = Number(trimmed);
    if (Number.isFinite(numeric)) return numeric;

    const brDate = parseDayFirstDateStringToUtcDate(trimmed);
    if (brDate) return brDate.getTime();

    const ptDate = parsePortugueseDateStringToUtcDate(trimmed);
    if (ptDate) return ptDate.getTime();

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }

  if (value instanceof Timestamp) {
    return value.toMillis();
  }

  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : null;
  }

  if (typeof value === "object" && typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }

  return null;
}

type AccessTokenData = FirebaseFirestore.DocumentData & {
  targetType?: "service" | "package" | string;
  targetId?: string;
  companyId?: string;
  company?: string;
  revoked?: boolean;
  active?: boolean;
  expiresAt?: TimestampLike;
  oneTime?: boolean;
};

type ServiceDoc = FirebaseFirestore.DocumentData & {
  status?: string;
  hasChecklist?: boolean;
  companyId?: string;
  company?: string;
};

type TargetDoc = FirebaseFirestore.DocumentData & {
  status?: string;
  companyId?: string;
  company?: string;
};

type ChecklistItem = {
  id: string;
  weight?: number;
  progress?: number;
};

type ProgressUpdate = {
  percent: number;
  createdAt: number;
};

const servicesCollection = () =>
  admin.firestore().collection("services") as FirebaseFirestore.CollectionReference<ServiceDoc>;

function sanitisePercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function inferChecklistStatus(progress: number): string {
  if (progress >= 100) return "concluido";
  if (progress > 0) return "andamento";
  return "nao_iniciado";
}

function normalisePercentFromUpdate(data: FirebaseFirestore.DocumentData): ProgressUpdate | null {
  // Prioritise the most recent manual edit fields so PCM/terceiro edits are not shadowed by stale percent values.
  const candidates = [data.manualPercent, data.realPercentSnapshot, data.percent];
  const createdAt =
    asTimestamp(data.reportDate) ??
    asTimestamp(data.date) ??
    asTimestamp((data.audit as FirebaseFirestore.DocumentData | undefined)?.submittedAt) ??
    asTimestamp(data.createdAt) ??
    Date.now();

  for (const candidate of candidates) {
    const parsed = typeof candidate === "number" ? candidate : Number(candidate ?? NaN);
    if (Number.isFinite(parsed)) {
      return { percent: sanitisePercent(parsed), createdAt: createdAt ?? Date.now() };
    }
  }

  return null;
}

async function recomputeServiceRealPercent(serviceId: string): Promise<number> {
  const serviceRef = servicesCollection().doc(serviceId);
  const [serviceSnap, updatesSnap] = await Promise.all([
    serviceRef.get(),
    serviceRef.collection("updates").get(),
  ]);

  if (!serviceSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Serviço não encontrado");
  }

  const serviceData = serviceSnap.data() || {};
  const hasChecklist = serviceData.hasChecklist === true;

  const updates = updatesSnap.docs
    .map((doc) => normalisePercentFromUpdate(doc.data() || {}))
    .filter((item): item is ProgressUpdate => Boolean(item))
    .sort((a, b) => b.createdAt - a.createdAt);

  const latestPercent = updates[0]?.percent ?? 0;

  let realPercent = latestPercent;
  if (hasChecklist) {
    await syncChecklistProgress(serviceId, latestPercent);
    realPercent = await computeRealPercentFromChecklist(serviceId);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  await serviceRef.update({
    realPercent,
    andamento: realPercent,
    progress: realPercent,
    displayStatus: resolveCanonicalStatus(serviceData, realPercent),
    manualPercent: realPercent,
    updatedAt: now,
    lastUpdateDate: now,
  });

  return realPercent;
}

async function syncChecklistProgress(serviceId: string, percent: number) {
  const clamped = sanitisePercent(percent);
  const status = inferChecklistStatus(clamped);
  const now = admin.firestore.FieldValue.serverTimestamp();

  const checklistCol = servicesCollection().doc(serviceId).collection("checklist");
  const snap = await checklistCol.get();
  if (snap.empty) return;

  const batch = admin.firestore().batch();

  snap.docs.forEach((doc) => {
    batch.update(doc.ref, {
      progress: clamped,
      status,
      updatedAt: now,
    });
  });

  await batch.commit();
}

function docDataWithTimestamps(doc: FirebaseFirestore.DocumentSnapshot) {
  const data = doc.data() || {};
  const converted: Record<string, unknown> = { ...data };
  for (const [key, value] of Object.entries(converted)) {
    if (value instanceof admin.firestore.Timestamp) {
      converted[key] = value.toMillis();
    }
  }
  return converted;
}

function applyCors(req: Request, res: Response): boolean {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

async function fetchAndValidateToken(
  tokenId: string,
): Promise<{
  tokenSnap: FirebaseFirestore.DocumentSnapshot<AccessTokenData>;
  tokenData: AccessTokenData;
}> {
  const tokenRef =
    admin
      .firestore()
      .collection("accessTokens") as FirebaseFirestore.CollectionReference<AccessTokenData>;
  const tokenSnap = await tokenRef.doc(tokenId).get();
  if (!tokenSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Token inválido");
  }

  const tokenData = tokenSnap.data() ?? ({} as AccessTokenData);
  if (tokenData.revoked === true || tokenData.active === false) {
    throw new functions.https.HttpsError("permission-denied", "Token inativo");
  }

  const expMillis = asTimestamp(tokenData.expiresAt);
  if (expMillis && expMillis < Date.now()) {
    throw new functions.https.HttpsError("deadline-exceeded", "Token expirado");
  }

  return { tokenSnap, tokenData };
}

function ensureCompanyMatch(
  tokenData: AccessTokenData,
  target: ServiceDoc | FirebaseFirestore.DocumentData,
) {
  const tokenCompany = tokenData.companyId || tokenData.company;
  if (!tokenCompany) return;

  const targetRecord = target as Record<string, unknown>;
  const targetCompany =
    typeof targetRecord.companyId === "string"
      ? targetRecord.companyId
      : typeof targetRecord.company === "string"
        ? targetRecord.company
        : undefined;
  if (targetCompany && targetCompany !== tokenCompany) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "Token não possui acesso a este recurso",
    );
  }
}

async function validateServiceAccess(
  tokenId: string,
  serviceId: string,
): Promise<{
  tokenData: AccessTokenData;
  serviceSnap: FirebaseFirestore.DocumentSnapshot<ServiceDoc>;
}> {
  const { tokenData } = await fetchAndValidateToken(tokenId);

  if (tokenData.targetType !== "service" || tokenData.targetId !== serviceId) {
    throw new functions.https.HttpsError("permission-denied", "Token não corresponde ao serviço");
  }

  const serviceRef = servicesCollection().doc(serviceId);
  const serviceSnap = await serviceRef.get();
  if (!serviceSnap.exists) {
    throw new functions.https.HttpsError("not-found", "Serviço não encontrado");
  }

  const serviceData = serviceSnap.data() || {};
  if (serviceData.status !== "aberto") {
    throw new functions.https.HttpsError("permission-denied", "Serviço não está aberto");
  }

  ensureCompanyMatch(tokenData, serviceData);

  return { tokenData, serviceSnap };
}

async function addManualUpdate(
  serviceId: string,
  percent: number,
  options: { note?: string; tokenId?: string } = {},
): Promise<number> {
  const sanitized = sanitisePercent(percent);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await admin.firestore().runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const updatesCol = serviceRef.collection("updates");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Serviço não encontrado");
    }

    const serviceData = serviceSnap.data() || {};
    const status = String(serviceData.displayStatus ?? serviceData.status ?? "").trim().toLowerCase();
    const reopenedProgress = status === "pendente"
      ? [serviceData.previousProgress, serviceData.progressBeforeConclusion, serviceData.previousPercent]
        .map((value) => Number(value))
        .find((value) => Number.isFinite(value) && sanitisePercent(value) < 100)
      : undefined;
    const currentPercentRaw = reopenedProgress !== undefined
      ? sanitisePercent(reopenedProgress)
      : [
        serviceData.andamento,
        serviceData.percentualRealAtual,
        serviceData.realPercentSnapshot,
        serviceData.manualPercent,
        serviceData.realPercent,
        serviceData.progress,
        serviceData.percent,
      ].map((value) => Number(value)).find(Number.isFinite) ?? 0;
    const currentPercent = sanitisePercent(currentPercentRaw);
    if (sanitized < currentPercent) {
      throw new functions.https.HttpsError(
        "invalid-argument",
        `O percentual não pode ser menor que o progresso atual de ${currentPercent}%.`,
      );
    }

    const updateRef = updatesCol.doc();
    const payload: Record<string, unknown> = {
      manualPercent: sanitized,
      realPercentSnapshot: sanitized,
      createdAt: now,
    };
    if (options.note !== undefined) payload.note = options.note;
    if (options.tokenId !== undefined) payload.token = options.tokenId;

    tx.set(updateRef, payload);

    tx.update(serviceRef, {
      realPercent: sanitized,
      manualPercent: sanitized,
      andamento: sanitized,
      progress: sanitized,
      percent: sanitized,
      percentualRealAtual: sanitized,
      realPercentSnapshot: sanitized,
      displayStatus: resolveCanonicalStatus(serviceSnap.data() || {}, sanitized),
      updatedAt: now,
      lastUpdateDate: now,
    });
  });

  return sanitized;
}

async function updateChecklistProgress(
  serviceId: string,
  updates: Array<{ id: string; progress: number; status?: string }>,
): Promise<number> {
  if (!updates.length) {
    return computeRealPercentFromChecklist(serviceId);
  }

  const now = admin.firestore.FieldValue.serverTimestamp();

  const realPercent = await admin.firestore().runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const checklistCol = serviceRef.collection("checklist");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Serviço não encontrado");
    }

    const checklistSnap = await tx.get(checklistCol);
    const itemsMap = new Map<string, ChecklistItem>();

    checklistSnap.docs.forEach((doc) => {
      const data = (doc.data() || {}) as ChecklistItem;
      itemsMap.set(doc.id, { id: doc.id, weight: data.weight ?? 0, progress: data.progress ?? 0 });
    });

    updates.forEach((update) => {
      const existing = itemsMap.get(update.id);
      if (!existing) {
        throw new functions.https.HttpsError(
          "not-found",
          `Item do checklist ${update.id} não encontrado`,
        );
      }

      const progress = sanitisePercent(update.progress);
      const status = update.status ?? inferChecklistStatus(progress);
      itemsMap.set(update.id, { ...existing, progress });

      tx.update(checklistCol.doc(update.id), {
        progress,
        status,
        updatedAt: now,
      });
    });

    const items = Array.from(itemsMap.values());
    const totalWeight = items.reduce((acc, item) => acc + (item.weight ?? 0), 0);
    const percent = totalWeight
      ? items.reduce((acc, item) => acc + (item.progress ?? 0) * (item.weight ?? 0), 0) / totalWeight
      : 0;
    const result = Math.round(percent * 100) / 100;
    const existingProgress = Number(serviceSnap.data()?.progress);
    const displayedProgress = Number.isFinite(existingProgress) ? existingProgress : result;

    tx.update(serviceRef, {
      realPercent: result,
      displayStatus: resolveCanonicalStatus(serviceSnap.data() || {}, displayedProgress),
      manualPercent: admin.firestore.FieldValue.delete(),
      updatedAt: now,
    });

    return result;
  });

  return realPercent;
}

async function addComputedUpdate(
  serviceId: string,
  realPercent: number,
  options: { note?: string; tokenId?: string } = {},
) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  await admin.firestore().runTransaction(async (tx) => {
    const serviceRef = servicesCollection().doc(serviceId);
    const updatesCol = serviceRef.collection("updates");

    const serviceSnap = await tx.get(serviceRef);
    if (!serviceSnap.exists) {
      throw new functions.https.HttpsError("not-found", "Serviço não encontrado");
    }

    const updateRef = updatesCol.doc();
    const payload: Record<string, unknown> = {
      realPercentSnapshot: sanitisePercent(realPercent),
      createdAt: now,
    };
    if (options.note !== undefined) payload.note = options.note;
    if (options.tokenId !== undefined) payload.token = options.tokenId;

    tx.set(updateRef, payload);
  });
}

async function computeRealPercentFromChecklist(serviceId: string): Promise<number> {
  const checklistCol = servicesCollection().doc(serviceId).collection("checklist");
  const snap = await checklistCol.get();
  if (snap.empty) return 0;

  const items = snap.docs.map((doc) => {
    const data = doc.data() || {};
    return {
      weight: data.weight ?? 0,
      progress: data.progress ?? 0,
    };
  });
  const totalWeight = items.reduce((acc, item) => acc + (item.weight ?? 0), 0);
  if (!totalWeight) return 0;

  const percent =
    items.reduce((acc, item) => acc + (item.progress ?? 0) * (item.weight ?? 0), 0) /
    totalWeight;
  return Math.round(percent * 100) / 100;
}

export const claimAccessV2 = functions
  .region(REGION)
  .https.onCall(async (data, ctx) => {
    const { tokenId } = (data || {}) as { tokenId?: string };
    if (!tokenId) {
      throw new functions.https.HttpsError("invalid-argument", "tokenId requerido");
    }

    try {
      const tokenRef =
        admin
          .firestore()
          .collection("accessTokens") as FirebaseFirestore.CollectionReference<AccessTokenData>;
      const tokenSnap = await tokenRef.doc(tokenId).get();

      if (!tokenSnap.exists) {
        console.error("[claimAccessV2] token não encontrado:", tokenId);
        throw new functions.https.HttpsError("not-found", "Token inválido");
      }

      const t = tokenSnap.data() ?? ({} as AccessTokenData);
      const { targetType, targetId, companyId, revoked, oneTime, expiresAt } = t;

      if (revoked === true) throw new functions.https.HttpsError("permission-denied", "Token revogado");
      const expMillis = asTimestamp(expiresAt);
      if (expMillis && expMillis < Date.now()) throw new functions.https.HttpsError("deadline-exceeded", "Token expirado");

      if (!targetType || !targetId || (targetType !== "service" && targetType !== "package")) {
        console.error("[claimAccessV2] token malformado:", t);
        throw new functions.https.HttpsError("invalid-argument", "Token malformado");
      }

      const col = targetType === "service" ? "services" : "packages";
      const targetCollection = admin.firestore().collection(col) as FirebaseFirestore.CollectionReference<TargetDoc>;
      const targetSnap = await targetCollection.doc(targetId).get();
      if (!targetSnap.exists) throw new functions.https.HttpsError("not-found", "Alvo não encontrado");

      const target = targetSnap.data() ?? ({} as TargetDoc);
      if (target.status !== "aberto") {
        console.warn("[claimAccessV2] alvo fechado:", { col, targetId, status: target.status });
        throw new functions.https.HttpsError("permission-denied", "Alvo não está aberto");
      }

      const uid = `token:${tokenId}`;
      try { await admin.auth().getUser(uid); } catch { await admin.auth().createUser({ uid }); }

      const claims: Record<string, any> = { role: "third" };
      if (targetType === "service") claims.serviceId = targetId;
      if (targetType === "package") claims.packageId = targetId;
      if (companyId) claims.companyId = companyId;

      await admin.auth().setCustomUserClaims(uid, claims);
      if (oneTime === true) await tokenRef.update({ revoked: true });

      const customToken = await admin.auth().createCustomToken(uid, claims);
      return { customToken, targetType, targetId };
    } catch (err: any) {
      if (err instanceof functions.https.HttpsError) throw err;
      console.error("[claimAccessV2] erro inesperado:", err?.stack || err);
      throw new functions.https.HttpsError("internal", "Falha interna ao validar token");
    }
  });

export const publicServiceUpdateManual = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const serviceId = typeof req.query.serviceId === "string" ? req.query.serviceId : undefined;
    const tokenId = typeof req.query.token === "string" ? req.query.token : undefined;

    if (!serviceId || !tokenId) {
      res.status(400).json({ ok: false, error: "serviceId e token são obrigatórios" });
      return;
    }

    try {
      const { serviceSnap } = await validateServiceAccess(tokenId, serviceId);
      const serviceData = serviceSnap.data() || {};

      if (serviceData.hasChecklist) {
        res.status(400).json({ ok: false, error: "Serviço possui checklist, use a rota apropriada" });
        return;
      }

      const body = (req.body || {}) as { percent?: unknown; note?: unknown };
      const percent = Number(body.percent);
      if (!Number.isFinite(percent)) {
        res.status(400).json({ ok: false, error: "percent inválido" });
        return;
      }

      const note = typeof body.note === "string" ? body.note : undefined;
      const realPercent = await addManualUpdate(serviceId, percent, { note, tokenId });

      res.json({ ok: true, realPercent });
    } catch (err: any) {
      const status = err instanceof functions.https.HttpsError ? mapHttpsErrorCode(err.code) : 500;
      res.status(status).json({ ok: false, error: err?.message ?? "Erro interno" });
    }
  });

export const publicServiceUpdateChecklist = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "POST") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const serviceId = typeof req.query.serviceId === "string" ? req.query.serviceId : undefined;
    const tokenId = typeof req.query.token === "string" ? req.query.token : undefined;

    if (!serviceId || !tokenId) {
      res.status(400).json({ ok: false, error: "serviceId e token são obrigatórios" });
      return;
    }

    try {
      const { serviceSnap } = await validateServiceAccess(tokenId, serviceId);
      const serviceData = serviceSnap.data() || {};

      if (!serviceData.hasChecklist) {
        res.status(400).json({ ok: false, error: "Serviço não possui checklist" });
        return;
      }

      const body = (req.body || {}) as {
        updates?: Array<{ id?: unknown; progress?: unknown; status?: unknown }>;
        note?: unknown;
      };

      if (!Array.isArray(body.updates)) {
        res.status(400).json({ ok: false, error: "updates deve ser um array" });
        return;
      }

      const updates = body.updates.map((item) => {
        const id = typeof item.id === "string" ? item.id : null;
        const progress = Number(item.progress);
        const status = typeof item.status === "string" ? item.status : undefined;
        if (!id || !Number.isFinite(progress)) {
          throw new functions.https.HttpsError("invalid-argument", "updates inválidos");
        }
        return { id, progress, status };
      });

      const note = typeof body.note === "string" ? body.note : undefined;

      const realPercent = await updateChecklistProgress(serviceId, updates);
      await addComputedUpdate(serviceId, realPercent, { note, tokenId });

      res.json({ ok: true, realPercent });
    } catch (err: any) {
      const status = err instanceof functions.https.HttpsError ? mapHttpsErrorCode(err.code) : 500;
      res.status(status).json({ ok: false, error: err?.message ?? "Erro interno" });
    }
  });

export const publicPackageServices = functions
  .region(REGION)
  .https.onRequest(async (req, res) => {
    if (applyCors(req, res)) return;
    if (req.method !== "GET") {
      res.status(405).json({ ok: false, error: "Method not allowed" });
      return;
    }

    const packageId = typeof req.query.packageId === "string" ? req.query.packageId : undefined;
    const tokenId = typeof req.query.token === "string" ? req.query.token : undefined;

    if (!packageId || !tokenId) {
      res.status(400).json({ ok: false, error: "packageId e token são obrigatórios" });
      return;
    }

    try {
      const { tokenData } = await fetchAndValidateToken(tokenId);

      if (tokenData.targetType !== "package" || tokenData.targetId !== packageId) {
        throw new functions.https.HttpsError("permission-denied", "Token não corresponde ao pacote");
      }

      const packageSnap = await admin.firestore().collection("packages").doc(packageId).get();
      if (!packageSnap.exists) {
        res.status(404).json({ ok: false, error: "Pacote não encontrado" });
        return;
      }

      const servicesSnap = await servicesCollection().where("packageId", "==", packageId).get();
      const tokenCompany = tokenData.companyId || tokenData.company;

      const services = servicesSnap.docs
        .filter((doc) => {
          if (!tokenCompany) return true;
          const data = doc.data() || {};
          const serviceCompany = data.companyId ?? data.company;
          return !serviceCompany || serviceCompany === tokenCompany;
        })
        .map((doc) => ({ id: doc.id, ...docDataWithTimestamps(doc) }));

      res.json({ ok: true, services });
    } catch (err: any) {
      const status = err instanceof functions.https.HttpsError ? mapHttpsErrorCode(err.code) : 500;
      res.status(status).json({ ok: false, error: err?.message ?? "Erro interno" });
    }
  });

function mapHttpsErrorCode(code: functions.https.FunctionsErrorCode): number {
  switch (code) {
    case "invalid-argument":
      return 400;
    case "not-found":
      return 404;
    case "permission-denied":
      return 403;
    case "deadline-exceeded":
      return 408;
    default:
      return 500;
  }
}

async function deactivateTokensByTarget(targetType: string, targetId: string): Promise<number> {
  if (!targetType || !targetId) return 0;

  const snap = await admin
    .firestore()
    .collection("accessTokens")
    .where("targetType", "==", targetType)
    .where("targetId", "==", targetId)
    .get();

  if (snap.empty) return 0;

  const now = admin.firestore.FieldValue.serverTimestamp();
  const batch = admin.firestore().batch();

  snap.docs.forEach((doc) => {
    batch.set(
      doc.ref,
      {
        active: false,
        revoked: true,
        status: "revoked",
        updatedAt: now,
      },
      { merge: true },
    );
  });

  await batch.commit();
  return snap.size;
}

export const onServiceDelete = functions
  .region(REGION)
  .firestore.document("services/{serviceId}")
  .onDelete(async (_snap, context) => {
    const serviceId = context.params.serviceId as string;

    try {
      await deactivateTokensByTarget("service", serviceId);
    } catch (error) {
      console.error(`[cleanup] Falha ao revogar tokens do serviço ${serviceId}`, error);
    }
  });

export const onPackageFolderDelete = functions
  .region(REGION)
  .firestore.document("packageFolders/{folderId}")
  .onDelete(async (_snap, context) => {
    const folderId = context.params.folderId as string;

    try {
      await deactivateTokensByTarget("folder", folderId);
    } catch (error) {
      console.error(`[cleanup] Falha ao revogar tokens do subpacote ${folderId}`, error);
    }
  });

export const onServiceUpdateWrite = functions.firestore
  .region(REGION)
  .document("services/{serviceId}/updates/{updateId}")
  .onWrite(async (_change, context) => {
    const serviceId = context.params.serviceId as string;

    try {
      const realPercent = await recomputeServiceRealPercent(serviceId);
      console.info(`[onServiceUpdateWrite] Recomputado progresso do serviço ${serviceId}: ${realPercent}%`);
    } catch (error) {
      console.error(`[onServiceUpdateWrite] Falha ao recomputar progresso do serviço ${serviceId}`, error);
    }
  });
