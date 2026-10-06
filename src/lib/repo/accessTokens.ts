import "server-only";

import crypto from "crypto";

import { FieldValue } from "firebase-admin/firestore";

import { getAdmin } from "@/lib/firebaseAdmin";
import { isCanonicalTokenActive } from "@/lib/accessTokenState";

type FirestoreLikeTimestamp = {
  toMillis?: () => number;
  seconds?: number;
  nanoseconds?: number;
} | null | undefined;

type RawTokenData = Record<string, unknown> & {
  active?: unknown;
  status?: unknown;
  revoked?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
  company?: unknown;
  companyId?: unknown;
  empresa?: unknown;
  empresaId?: unknown;
  code?: unknown;
  targetId?: unknown;
  targetType?: unknown;
  serviceId?: unknown;
  packageId?: unknown;
  folderId?: unknown;
  pastaId?: unknown;
};

export type ServiceAccessToken = {
  code: string;
  company?: string;
  createdAt?: number;
  expiresAt?: number;
};

function toMillis(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isNaN(time) ? undefined : time;
  }
  const ts = value as FirestoreLikeTimestamp;
  if (ts && typeof ts.toMillis === "function") {
    const millis = ts.toMillis();
    if (typeof millis === "number" && Number.isFinite(millis)) {
      return millis;
    }
  }
  if (ts && typeof ts.seconds === "number") {
    const base = ts.seconds * 1000;
    const fraction = typeof ts.nanoseconds === "number" ? ts.nanoseconds / 1_000_000 : 0;
    const total = base + fraction;
    return Number.isFinite(total) ? total : undefined;
  }
  return undefined;
}

function normaliseCompany(data: RawTokenData): string | undefined {
  const candidates = [data.company, data.companyId, data.empresa, data.empresaId];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isTokenActive(data: RawTokenData, now: number): boolean {
  return isCanonicalTokenActive({ ...data, expiresAtMillis: toMillis(data.expiresAt) }, now);
}

async function getPointedServiceToken(serviceId: string): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const { db } = getAdmin();
  const serviceSnap = await db.collection("services").doc(serviceId).get();
  if (!serviceSnap.exists) return null;
  const data = serviceSnap.data() ?? {};
  const code =
    (typeof data.accessTokenCode === "string" && data.accessTokenCode.trim()) ||
    (typeof data.activeTokenCode === "string" && data.activeTokenCode.trim()) ||
    "";
  if (!code) return null;
  const tokenSnap = await db.collection("accessTokens").doc(code).get();
  if (!tokenSnap.exists || !isTokenActive((tokenSnap.data() ?? {}) as RawTokenData, Date.now())) return null;
  return tokenSnap;
}

async function pointServiceToToken(serviceId: string, code: string): Promise<void> {
  const { db } = getAdmin();
  await db.collection("services").doc(serviceId).set(
    { accessTokenCode: code, activeTokenCode: code, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
}

async function getIndexedActiveServiceTokenSnapshot(serviceId: string) {
  const { db } = getAdmin();
  try {
    return await db
      .collection("accessTokens")
      .where("targetType", "==", "service")
      .where("targetId", "==", serviceId)
      .where("status", "==", "active")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
  } catch (error) {
    // Durante o intervalo entre deploy da aplicação e criação do índice
    // composto, ainda conseguimos localizar o token canônico por campos com
    // índices simples. Mantemos limit(1), sem varrer tokens históricos.
    console.warn(`[accessTokens] Índice canônico indisponível para o serviço ${serviceId}; usando fallback limitado.`, error);
    return db
      .collection("accessTokens")
      .where("serviceId", "==", serviceId)
      .where("active", "==", true)
      .limit(1)
      .get();
  }
}

export async function getLatestServiceToken(serviceId: string): Promise<ServiceAccessToken | null> {
  if (!serviceId) return null;
  const { db } = getAdmin();

  let doc = await getPointedServiceToken(serviceId);
  let snap: FirebaseFirestore.QuerySnapshot | null = null;
  if (!doc) snap = await getIndexedActiveServiceTokenSnapshot(serviceId);

  if (!doc && snap?.empty) {
    // Compatibilidade de leitura: documentos anteriores ao estado canônico
    // podem não ter `status`. A consulta continua limitada a um documento e
    // nunca varre o histórico inteiro.
    snap = await db
      .collection("accessTokens")
      .where("targetType", "==", "service")
      .where("targetId", "==", serviceId)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();
    if (snap.empty) return null;
  }

  const now = Date.now();
  doc = doc ?? snap?.docs[0] ?? null;
  if (!doc) return null;
  const data = (doc.data() ?? {}) as RawTokenData;
  if (!isTokenActive(data, now)) return null;

  const tokenTargetId =
    (typeof data.targetId === "string" && data.targetId.trim()) ||
    (typeof data.serviceId === "string" && data.serviceId.trim()) ||
    null;

  if (tokenTargetId && tokenTargetId !== serviceId) return null;

  const code = (typeof data.code === "string" && data.code.trim()) || doc.id;

  if (!code) return null;

  const createdAt = toMillis(data.createdAt);
  const expiresAt = toMillis(data.expiresAt);

  return { code, company: normaliseCompany(data), createdAt, expiresAt };
}

type EnsureServiceTokenInput = { serviceId: string; company?: string | null };

function randomToken(length = 8) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.randomBytes(length);
  let token = "";
  for (let i = 0; i < length; i += 1) {
    token += alphabet[bytes[i] % alphabet.length];
  }
  return token;
}

export async function ensureServiceAccessToken({ serviceId, company }: EnsureServiceTokenInput) {
  if (!serviceId) return null;

  const { db } = getAdmin();
  const now = Date.now();

  const pointed = await getPointedServiceToken(serviceId);
  if (pointed) {
    const pointedData = (pointed.data() ?? {}) as RawTokenData;
    const pointedCompany = normaliseCompany(pointedData);
    if (!company || pointedCompany === company) {
      return {
        code: (typeof pointedData.code === "string" && pointedData.code.trim()) || pointed.id,
        company: pointedCompany,
        createdAt: toMillis(pointedData.createdAt),
        expiresAt: toMillis(pointedData.expiresAt),
      } satisfies ServiceAccessToken;
    }
  }

  let snapshot: FirebaseFirestore.QuerySnapshot | null = null;
  try {
    let activeQuery: FirebaseFirestore.Query = db
      .collection("accessTokens")
      .where("targetType", "==", "service")
      .where("targetId", "==", serviceId)
      .where("status", "==", "active");
    if (company) activeQuery = activeQuery.where("company", "==", company);
    snapshot = await activeQuery.orderBy("createdAt", "desc").limit(1).get();
  } catch (error) {
    console.warn(`[accessTokens] Índice de reutilização indisponível para o serviço ${serviceId}; usando fallback limitado.`, error);
    try {
      snapshot = await db
        .collection("accessTokens")
        .where("serviceId", "==", serviceId)
        .where("active", "==", true)
        .limit(1)
        .get();
    } catch (fallbackError) {
      // Não deixe indisponibilidade de índice impedir a geração. O token novo
      // será gravado junto com um ponteiro direto no serviço.
      console.warn(`[accessTokens] Fallback de consulta indisponível para ${serviceId}; criando token canônico.`, fallbackError);
    }
  }

  if (snapshot?.empty) {
    try {
      snapshot = await db
        .collection("accessTokens")
        .where("targetType", "==", "service")
        .where("targetId", "==", serviceId)
        .orderBy("createdAt", "desc")
        .limit(1)
        .get();
    } catch (legacyError) {
      console.warn(`[accessTokens] Consulta legada indisponível para ${serviceId}; criando token canônico.`, legacyError);
      snapshot = null;
    }
  }

  let latestMatch: ServiceAccessToken | null = null;

  snapshot?.forEach((docSnap) => {
    const data = (docSnap.data() ?? {}) as RawTokenData;
    if (!isTokenActive(data, now)) return;

    const docCompany = normaliseCompany(data);
    if (company) {
      if (!docCompany || docCompany !== company) return;
    }

    const code = (typeof data.code === "string" && data.code.trim()) || docSnap.id;
    if (!code) return;

    const createdAt = toMillis(data.createdAt) ?? 0;
    if (!latestMatch || (latestMatch.createdAt ?? 0) < createdAt) {
      latestMatch = { code, company: docCompany, createdAt };
    }
  });

  if (latestMatch) {
    await pointServiceToToken(serviceId, latestMatch.code);
    return latestMatch;
  }

  for (let attempts = 0; attempts < 5; attempts += 1) {
    const code = randomToken();
    const ref = db.collection("accessTokens").doc(code);
    const existing = await ref.get();
    if (existing.exists) continue;

    const payload: Record<string, unknown> = {
      code,
      token: code,
      active: true,
      status: "active",
      targetType: "service",
      targetId: serviceId,
      serviceId,
      createdAt: FieldValue.serverTimestamp(),
    };

    if (company) {
      payload.company = company;
      payload.companyId = company;
      payload.empresa = company;
      payload.empresaId = company;
    }

    const batch = db.batch();
    batch.create(ref, payload);
    batch.set(
      db.collection("services").doc(serviceId),
      { accessTokenCode: code, activeTokenCode: code, updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
    return { code, company: company ?? undefined, createdAt: Date.now() } satisfies ServiceAccessToken;
  }

  throw new Error("Não foi possível gerar um token único para o serviço.");
}
