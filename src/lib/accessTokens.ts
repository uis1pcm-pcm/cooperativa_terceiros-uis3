import { tryGetAuth, tryGetFirestore } from "./firebase";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "firebase/firestore";

export function randomToken(len = 8) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sem 0/O/1/I
  let out = "";
  for (let i = 0; i < len; i++) out += a[Math.floor(Math.random() * a.length)];
  return out;
}

type NormalisedScope = {
  targetType: "service" | "folder";
  targetId: string;
  company?: string;
  packageId?: string;
};

type FirestoreLikeTimestamp =
  | { toMillis?: () => number; seconds?: number; nanoseconds?: number }
  | null
  | undefined;

type AccessTokenDoc = Record<string, unknown> & {
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
  serviceId?: unknown;
  packageId?: unknown;
  pacoteId?: unknown;
};

type StoredToken = {
  code: string;
  createdAt?: number;
};

function normaliseScope(payload: {
  serviceId?: string | null;
  packageId?: string | null;
  pacoteId?: string | null;
  folderId?: string | null;
  pastaId?: string | null;
  empresa?: string | null;
  company?: string | null;
}): NormalisedScope {
  const serviceId = (payload.serviceId ?? "").trim();
  const packageId = (payload.packageId ?? payload.pacoteId ?? "").trim();
  const folderId = (payload.folderId ?? payload.pastaId ?? "").trim();
  const company = (payload.empresa ?? payload.company ?? "").trim();

  if (serviceId) {
    return {
      targetType: "service",
      targetId: serviceId,
      company: company || undefined,
    };
  }

  if (folderId) {
    return {
      targetType: "folder",
      targetId: folderId,
      company: company || undefined,
      packageId: packageId || undefined,
    };
  }

  throw new Error("É necessário informar serviceId ou folderId para gerar o token.");
}

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

function normaliseCompany(data: AccessTokenDoc): string | undefined {
  const candidates = [data.company, data.companyId, data.empresa, data.empresaId];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function isTokenActive(data: AccessTokenDoc, now: number): boolean {
  if (data.active === false) return false;
  if (data.revoked === true) return false;
  const status = typeof data.status === "string" ? data.status.trim().toLowerCase() : undefined;
  if (status === "revoked" || status === "inactive") return false;

  const expiresAt = toMillis(data.expiresAt);
  if (expiresAt && expiresAt < now) return false;

  return true;
}

async function findExistingToken(scope: NormalisedScope): Promise<StoredToken | null> {
  const { db } = tryGetFirestore();
  if (!db) return null;

  async function getSnapshot(field: "targetId" | "serviceId" | "folderId" | "pastaId") {
    try {
      const q = query(
        collection(db, "accessTokens"),
        where("targetType", "==", scope.targetType),
        where(field, "==", scope.targetId),
        limit(20),
      );
      return await getDocs(q);
    } catch (error) {
      console.warn("[accessTokens] Falha ao consultar tokens existentes", error);
      return null;
    }
  }

  let snapshot: Awaited<ReturnType<typeof getSnapshot>> | null = null;
  const preferredFields: Array<"targetId" | "serviceId" | "folderId" | "pastaId"> = ["targetId"];
  if (scope.targetType === "service") {
    preferredFields.push("serviceId");
  } else {
    preferredFields.push("folderId", "pastaId");
  }

  for (const field of preferredFields) {
    const snap = await getSnapshot(field);
    if (snap && !snap.empty) {
      snapshot = snap;
      break;
    }
  }

  if (!snapshot) {
    return null;
  }

  const now = Date.now();
  const expectedCompany = scope.company ?? undefined;
  const tokens: StoredToken[] = [];

  snapshot.forEach((docSnap) => {
    const data = (docSnap.data() ?? {}) as AccessTokenDoc;
    if (!isTokenActive(data, now)) return;

    const tokenTargetId =
      (typeof data.targetId === "string" && data.targetId.trim()) ||
      (typeof data.serviceId === "string" && data.serviceId.trim()) ||
      (typeof (data as Record<string, unknown>).folderId === "string" &&
        ((data as Record<string, unknown>).folderId as string).trim()) ||
      (typeof (data as Record<string, unknown>).pastaId === "string" &&
        ((data as Record<string, unknown>).pastaId as string).trim()) ||
      null;

    if (tokenTargetId && tokenTargetId !== scope.targetId) {
      return;
    }

    const docCompany = normaliseCompany(data);
    if (expectedCompany) {
      if (!docCompany || docCompany !== expectedCompany) {
        return;
      }
    } else if (docCompany) {
      return;
    }

    const code =
      (typeof data.code === "string" && data.code.trim()) ||
      docSnap.id;

    if (!code) return;

    const createdAt = toMillis(data.createdAt);
    tokens.push({ code, createdAt });
  });

  if (!tokens.length) {
    return null;
  }

  tokens.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return tokens[0] ?? null;
}

// Force a fresh ID token after permission-sensitive backend changes so Firestore Rules see updated custom claims.
function requestClaimsRefresh() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event("pcm:force-token-refresh"));
}

async function createTokenViaAdmin(scope: NormalisedScope): Promise<string> {
  const { auth, error } = tryGetAuth();
  const user = auth?.currentUser;
  if (!user) {
    const fallbackError = error ?? new Error("Faça login novamente para gerar tokens.");
    throw Object.assign(fallbackError, { status: 401 });
  }

  const idToken = await user.getIdToken();
  const response = await fetch("/api/management/tokens/create", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({
      targetType: scope.targetType,
      targetId: scope.targetId,
      company: scope.company,
      packageId: scope.targetType === "folder" ? scope.packageId : undefined,
      folderId: scope.targetType === "folder" ? scope.targetId : undefined,
    }),
  });

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data && typeof data === "object" && data && "error" in data && typeof (data as { error?: unknown }).error === "string"
        ? ((data as { error: string }).error ?? "")
        : "Não foi possível gerar o token.";
    const error = new Error(message || "Não foi possível gerar o token.");
    (error as Error & { status?: number }).status = response.status;
    throw error;
  }

  if (!data || typeof data !== "object" || !("token" in data) || typeof (data as { token?: unknown }).token !== "string") {
    throw Object.assign(new Error("Resposta inesperada ao gerar token."), { status: response.status });
  }

  return (data as { token: string }).token;
}

async function createTokenFallback(scope: NormalisedScope): Promise<string> {
  const { db, error } = tryGetFirestore();
  if (!db) {
    throw error ?? new Error("Firestore não está configurado para gerar tokens.");
  }
  let code = randomToken(8);
  for (let attempt = 0; attempt < 5; attempt++) {
    const ref = doc(collection(db, "accessTokens"), code);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      code = randomToken(8);
      continue;
    }

    const payload: Record<string, unknown> = {
      code,
      token: code,
      status: "active",
      active: true,
      targetType: scope.targetType,
      targetId: scope.targetId,
      createdAt: serverTimestamp(),
    };

    if (scope.company) {
      payload.company = scope.company;
      payload.companyId = scope.company;
      payload.empresa = scope.company;
      payload.empresaId = scope.company;
    }

    if (scope.targetType === "service") {
      payload.serviceId = scope.targetId;
    } else {
      payload.folderId = scope.targetId;
      payload.pastaId = scope.targetId;
      if (scope.packageId) {
        payload.packageId = scope.packageId;
        payload.pacoteId = scope.packageId;
      }
    }

    await setDoc(ref, payload);
    return code;
  }

  throw new Error("Não foi possível gerar um token único.");
}

export async function createAccessToken(payload: {
  serviceId?: string;
  packageId?: string;
  pacoteId?: string;
  folderId?: string;
  pastaId?: string;
  empresa?: string;
  company?: string;
}) {
  const scope = normaliseScope(payload);

  try {
    const existing = await findExistingToken(scope);
    if (existing?.code) {
      return existing.code;
    }
  } catch (error) {
    console.warn("[accessTokens] Falha ao reutilizar token existente", error);
  }

  try {
    const token = await createTokenViaAdmin(scope);
    requestClaimsRefresh();
    return token;
  } catch (error) {
    const status = (error as { status?: number } | null)?.status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      throw error;
    }

    console.warn("[accessTokens] Falha ao usar API admin, tentando fallback", error);
    const token = await createTokenFallback(scope);
    requestClaimsRefresh();
    return token;
  }
}
