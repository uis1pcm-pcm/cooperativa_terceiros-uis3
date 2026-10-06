"use server";

import { randomUUID } from "crypto";

import { getAdminDbOrThrow } from "@/lib/serverDb";

export type PackageShare = {
  id: string;
  token: string;
  packageId: string;
  serviceIds: string[];
  createdAt: Date;
  expiresAt?: Date | null;
  active: boolean;
};

type FirestoreDateLike =
  | Date
  | number
  | { toDate?: () => Date | null; toMillis?: () => number | null }
  | null
  | undefined;

type PackageShareDocData = Record<string, unknown> & {
  token?: unknown;
  packageId?: unknown;
  serviceIds?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
  active?: unknown;
};

const PACKAGE_SHARE_DEFAULT_TTL_SECONDS = 7 * 24 * 60 * 60;

function packageSharesCollection() {
  return getAdminDbOrThrow().collection("packageShares");
}

function toDate(value: FirestoreDateLike): Date | undefined {
  if (!value) return undefined;
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isNaN(millis) ? undefined : new Date(millis);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }
  const maybe = value as { toDate?: () => Date | null; toMillis?: () => number | null };
  if (typeof maybe?.toDate === "function") {
    const date = maybe.toDate();
    if (date instanceof Date) {
      const millis = date.getTime();
      if (!Number.isNaN(millis)) {
        return new Date(millis);
      }
    }
  }
  if (typeof maybe?.toMillis === "function") {
    const millis = maybe.toMillis();
    if (typeof millis === "number" && Number.isFinite(millis)) {
      const date = new Date(millis);
      return Number.isNaN(date.getTime()) ? undefined : date;
    }
  }
  return undefined;
}

function normaliseId(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseServiceIds(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
  }
  return Array.from(seen);
}

function mapPackageShare(doc: FirebaseFirestore.DocumentSnapshot): PackageShare {
  const data = (doc.data() ?? {}) as PackageShareDocData;
  const createdAt = toDate(data.createdAt) ?? new Date(0);
  const expiresAt = toDate(data.expiresAt);

  const token = normaliseId(data.token) || doc.id;
  return {
    id: doc.id,
    token,
    packageId: normaliseId(data.packageId),
    serviceIds: normaliseServiceIds(data.serviceIds),
    createdAt,
    expiresAt: expiresAt ?? null,
    active: data.active !== false,
  };
}

export async function createPackageShare(params: {
  packageId: string;
  serviceIds: string[];
  ttlSeconds?: number;
}): Promise<PackageShare> {
  const packageId = normaliseId(params.packageId);
  if (!packageId) {
    throw new Error("packageId é obrigatório para criar compartilhamento de pacote.");
  }

  const serviceIds = normaliseServiceIds(params.serviceIds);
  if (!serviceIds.length) {
    throw new Error("Selecione pelo menos um serviço para compartilhar.");
  }

  const token = randomUUID();
  const now = new Date();
  const ttlSeconds = typeof params.ttlSeconds === "number" ? params.ttlSeconds : PACKAGE_SHARE_DEFAULT_TTL_SECONDS;
  const expiresAt = Number.isFinite(ttlSeconds) && ttlSeconds > 0 ? new Date(now.getTime() + ttlSeconds * 1000) : null;

  const collection = packageSharesCollection();
  const docRef = collection.doc();

  const payload: Record<string, unknown> = {
    token,
    packageId,
    serviceIds,
    createdAt: now,
    active: true,
  };

  if (expiresAt) {
    payload.expiresAt = expiresAt;
  }

  await docRef.set(payload);

  return {
    id: docRef.id,
    token,
    packageId,
    serviceIds,
    createdAt: now,
    expiresAt,
    active: true,
  };
}

export async function getPackageShareByToken(token: string): Promise<PackageShare | null> {
  const trimmedToken = normaliseId(token);
  if (!trimmedToken) return null;

  const collection = packageSharesCollection();
  const snap = await collection.where("token", "==", trimmedToken).limit(1).get();
  if (snap.empty) return null;

  const share = mapPackageShare(snap.docs[0]);
  if (!share.active) return null;

  if (share.expiresAt && share.expiresAt.getTime() <= Date.now()) {
    return null;
  }

  return share;
}

export async function deactivatePackageShare(idOrToken: string): Promise<void> {
  const identifier = normaliseId(idOrToken);
  if (!identifier) return;

  const collection = packageSharesCollection();
  const docRef = collection.doc(identifier);
  const docSnap = await docRef.get();
  if (docSnap.exists) {
    if (docSnap.get("active") === false) {
      return;
    }
    await docRef.update({ active: false });
    return;
  }

  const snap = await collection.where("token", "==", identifier).get();
  if (snap.empty) {
    return;
  }

  const updates = snap.docs.filter((doc) => doc.get("active") !== false).map((doc) => doc.ref.update({ active: false }));
  if (!updates.length) {
    return;
  }

  await Promise.all(updates);
}
