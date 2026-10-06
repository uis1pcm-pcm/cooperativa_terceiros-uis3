import { NextRequest, NextResponse } from "next/server";
import { Timestamp, type Firestore } from "firebase-admin/firestore";

import { parseDayFirstDateStringToUtcDate, parsePortugueseDateStringToUtcDate } from "@/lib/dateParsing";
import { AdminDbUnavailableError, getAdminDbOrThrow } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";
import { recomputeServiceProgress } from "@/lib/progressHistoryServer";
import { revalidateTag } from "next/cache";

type TokenScope =
  | { type: "service"; serviceId: string }
  | { type: "folder"; folderId: string; packageId?: string | null; empresa?: string | null };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return undefined;
}

function isTokenActive(data: unknown) {
  if (!isRecord(data)) return true;
  if (typeof data.active === "boolean") return data.active;
  const status = typeof data.status === "string" ? data.status.toLowerCase() : "";
  if (!status) return true;
  return status === "active" || status === "ativo" || status === "aberto";
}

function parseTokenScope(data: unknown): TokenScope | null {
  if (!isRecord(data)) return null;
  const scope = isRecord(data.scope) ? (data.scope as Record<string, unknown>) : undefined;
  const scopeService = scope && isRecord(scope.service) ? (scope.service as Record<string, unknown>) : undefined;

  const scopeType = typeof scope?.type === "string" ? scope.type.toLowerCase() : "";

  if (scopeType === "service") {
    const serviceId =
      getStringField(scope, "serviceId", "targetId") ||
      (scopeService ? getStringField(scopeService, "id") : undefined);
    if (serviceId) {
      return { type: "service", serviceId };
    }
  }

  if (scopeType === "folder") {
    const folderId = getStringField(scope, "folderId", "pastaId", "targetId");
    if (folderId) {
      const packageId = getStringField(scope, "packageId", "pacoteId");
      const empresa = getStringField(scope, "empresa", "empresaId", "company");
      return { type: "folder", folderId, packageId, empresa };
    }
  }

  const resolvedTargetId = getStringField(data, "targetId");
  const targetType = typeof data.targetType === "string" ? data.targetType.toLowerCase() : "";

  const directService =
    getStringField(data, "serviceId") ||
    (scope ? getStringField(scope, "serviceId") : undefined) ||
    (scopeService ? getStringField(scopeService, "id") : undefined) ||
    (targetType === "service" ? resolvedTargetId : undefined);
  if (directService) {
    return { type: "service", serviceId: directService };
  }

  const folderId =
    getStringField(data, "folderId", "pastaId") ||
    (scope ? getStringField(scope, "folderId", "pastaId") : undefined) ||
    (targetType === "folder" ? resolvedTargetId : undefined) ||
    (scope ? getStringField(scope, "targetId") : undefined);

  if (folderId) {
    const packageId =
      getStringField(data, "packageId", "pacoteId") ||
      (scope ? getStringField(scope, "packageId", "pacoteId") : undefined);
    const empresa =
      getStringField(data, "empresa", "empresaId", "company", "companyId") ||
      (scope ? getStringField(scope, "empresa", "empresaId", "company") : undefined);
    return { type: "folder", folderId, packageId, empresa };
  }

  return null;
}

function normalizeCompany(value?: string | null) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

async function handleWithAdmin(
  adminDb: Firestore,
  req: NextRequest,
  payload: {
    token: string;
    serviceId: string;
    items?: Array<{ itemId: string; pct: number }>;
    totalPct?: number;
    note?: string;
    date?: string;
  },
) {
  const upperToken = payload.token;
  const byCode = await adminDb.collection("accessTokens").where("code", "==", upperToken).limit(1).get();
  let doc = byCode.docs[0];
  if (!doc) {
    const legacy = await adminDb.collection("accessTokens").where("token", "==", upperToken).limit(1).get();
    doc = legacy.docs[0];
  }
  if (!doc) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 403 });
  }
  const tokenData = (doc.data() ?? {}) as Record<string, unknown>;
  if (!isTokenActive(tokenData)) {
    return NextResponse.json({ ok: false, error: "invalid_token" }, { status: 403 });
  }

  const scope = parseTokenScope(tokenData);
  if (!scope) {
    return NextResponse.json({ ok: false, error: "invalid_scope" }, { status: 403 });
  }

  const serviceRef = adminDb.collection("services").doc(payload.serviceId);
  const serviceSnap = await serviceRef.get();
  if (!serviceSnap.exists) {
    return NextResponse.json({ ok: false, error: "service_not_found" }, { status: 404 });
  }
  const serviceData = (serviceSnap.data() ?? {}) as Record<string, unknown>;

  if (scope.type === "service" && scope.serviceId !== payload.serviceId) {
    return NextResponse.json({ ok: false, error: "forbidden_scope" }, { status: 403 });
  }

  if (scope.type === "folder") {
    const folderRef = adminDb.collection("packageFolders").doc(scope.folderId);
    const folderSnap = await folderRef.get();
    if (!folderSnap.exists) {
      return NextResponse.json({ ok: false, error: "forbidden_scope" }, { status: 403 });
    }

    const folderData = (folderSnap.data() ?? {}) as Record<string, unknown>;
    const services = Array.isArray(folderData.services)
      ? (folderData.services as unknown[])
          .map((value) => (typeof value === "string" ? value.trim() : ""))
          .filter((value) => value.length > 0)
      : [];
    if (!services.includes(payload.serviceId)) {
      return NextResponse.json({ ok: false, error: "forbidden_scope" }, { status: 403 });
    }

    const empresaToken = normalizeCompany(scope.empresa ?? null);
    const folderCompany = normalizeCompany(
      getStringField(folderData, "companyId", "company", "empresa") ?? null,
    );
    if (empresaToken && folderCompany && folderCompany !== empresaToken) {
      return NextResponse.json({ ok: false, error: "forbidden_scope" }, { status: 403 });
    }

    if (empresaToken) {
      const svcCompany = normalizeCompany(
        getStringField(serviceData, "empresaId", "company", "empresa") ?? null,
      );
      if (svcCompany && svcCompany !== empresaToken) {
        return NextResponse.json({ ok: false, error: "forbidden_scope" }, { status: 403 });
      }
    }

    const expectedPackage = scope.packageId ?? getStringField(folderData, "packageId", "pacoteId") ?? null;
    if (expectedPackage) {
      const svcPackage = getStringField(serviceData, "packageId", "pacoteId") ?? null;
      if (svcPackage && svcPackage !== expectedPackage) {
        return NextResponse.json({ ok: false, error: "forbidden_scope" }, { status: 403 });
      }
    }
  }

  const submittedPercent = Number(payload.totalPct);
  if (!Number.isFinite(submittedPercent) || submittedPercent < 0 || submittedPercent > 100) {
    return NextResponse.json({ ok: false, error: "invalid_percent" }, { status: 400 });
  }
  const forwarded = req.headers.get("x-forwarded-for");
  const realIp = req.headers.get("x-real-ip");
  const ip = forwarded?.split(",")[0]?.trim() || realIp?.trim();

  let updateDate = Timestamp.now();
  if (payload.date) {
    let parsed: Date | null = null;
    if (typeof payload.date === "string") {
      const trimmed = payload.date.trim();
      parsed =
        parseDayFirstDateStringToUtcDate(trimmed) ??
        parsePortugueseDateStringToUtcDate(trimmed) ??
        (() => {
          const candidate = new Date(trimmed);
          return Number.isNaN(candidate.getTime()) ? null : candidate;
        })();
    } else if (typeof payload.date === "number") {
      const candidate = new Date(payload.date);
      parsed = Number.isNaN(candidate.getTime()) ? null : candidate;
    } else if (payload.date instanceof Date) {
      parsed = Number.isNaN(payload.date.getTime()) ? null : payload.date;
    }

    if (parsed) {
      updateDate = Timestamp.fromDate(parsed);
    }
  }

  const update: {
    date: Timestamp;
    note?: string;
    by: "token";
    items?: Array<{ itemId: string; pct: number }>;
    totalPct?: number;
    tokenId: string;
    ip?: string;
  } = {
    date: updateDate,
    note: typeof payload.note === "string" && payload.note.trim() ? payload.note.trim() : undefined,
    by: "token",
    items: payload.items && payload.items.length > 0 ? payload.items : undefined,
    totalPct: typeof payload.totalPct === "number" ? payload.totalPct : undefined,
    tokenId: doc.id,
    ip: ip || undefined,
  };

  const legacyUpdateRef = serviceRef.collection("serviceUpdates").doc();
  const batch = adminDb.batch();
  batch.set(legacyUpdateRef, update);
  batch.set(serviceRef, { hasLegacyServiceUpdates: true }, { merge: true });
  await batch.commit();
  revalidateTag(`service:${payload.serviceId}:legacy-updates`);

  const { percent } = await recomputeServiceProgress(payload.serviceId);

  return NextResponse.json({ ok: true, andamento: percent });
}


export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { token, serviceId, items, totalPct, note, date } = body ?? {};
    if (!token || typeof token !== "string" || !serviceId || typeof serviceId !== "string") {
      return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });
    }

    const upperToken = token.trim().toUpperCase();
    const payload = {
      token: upperToken,
      serviceId: serviceId.trim(),
      items,
      totalPct,
      note,
      date,
    };

    const adminDb = getAdminDbOrThrow();
    return await handleWithAdmin(adminDb, req, payload);
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error("[progresso/update] Firebase Admin não configurado", error);
      return NextResponse.json({ ok: false, error: "Configuração de acesso ao banco indisponível." }, { status: 500 });
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn("[progresso/update] Falha de permissão ou recurso", error);
      return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
    }

    console.error("[progresso/update] Erro inesperado", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
