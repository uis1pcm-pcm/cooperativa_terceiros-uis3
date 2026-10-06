import { NextResponse } from "next/server";
import type { DocumentSnapshot, QueryDocumentSnapshot, Firestore } from "firebase-admin/firestore";

import { AdminDbUnavailableError, getAdminDbOrThrow } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";
import { collectFolderServiceIds } from "@/lib/folderServices";

function normalizeCompany(raw?: unknown) {
  if (typeof raw !== "string") return "";
  return raw.trim().toLowerCase();
}

function toOptionalString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function extractTokenData(data: unknown, docId?: string | null) {
  const record = asRecord(data) ?? {};
  const scope = asRecord(record.scope);
  const scopeService = asRecord(scope?.service);

  const resolvedTargetId = toOptionalString(record.targetId) ?? toOptionalString(docId);
  const directServiceId =
    toOptionalString(record.serviceId) ??
    toOptionalString(scope?.serviceId) ??
    toOptionalString(scope?.targetId) ??
    toOptionalString(scopeService?.id);

  const directFolderId =
    toOptionalString((record as Record<string, unknown>).folderId) ??
    toOptionalString((record as Record<string, unknown>).pastaId) ??
    toOptionalString(scope?.folderId) ??
    toOptionalString(scope?.pastaId);

  const targetType = typeof record.targetType === "string" ? record.targetType : "";

  const serviceId = directServiceId ?? (targetType === "service" ? resolvedTargetId : null);
  const folderId = directFolderId ?? (targetType === "folder" ? resolvedTargetId : null);

  const empresa =
    toOptionalString(record.empresa) ??
    toOptionalString(record.empresaId) ??
    toOptionalString(scope?.empresaId) ??
    toOptionalString(scope?.company) ??
    toOptionalString(scope?.empresa) ??
    toOptionalString(record.company) ??
    toOptionalString(record.companyId);

  return {
    serviceId,
    folderId,
    empresa,
  };
}

function extractServiceCompany(data: Record<string, unknown>): string {
  const candidates = [data.company, data.companyId, data.empresa, data.empresaId];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return normalizeCompany(value);
    }
  }
  return "";
}

async function fetchFolderServicesAdmin(db: Firestore, folderId: string, empresa: string | null) {
  const folderSnap = await db.collection("packageFolders").doc(folderId).get();
  if (!folderSnap.exists) return [];

  const data = (folderSnap.data() ?? {}) as Record<string, unknown>;
  const services = collectFolderServiceIds({
    services: data.services,
    serviceIds: (data as Record<string, unknown>).serviceIds,
    servicos: (data as Record<string, unknown>).servicos,
  });

  const normalizedEmpresa = normalizeCompany(empresa ?? undefined);
  const folderCompany = normalizeCompany(data.companyId ?? data.company ?? data.empresa ?? undefined);
  if (normalizedEmpresa && folderCompany && normalizedEmpresa !== folderCompany) {
    return [];
  }

  const seen = new Set<string>();
  for (const serviceId of services) {
    if (seen.has(serviceId)) continue;
    const docSnap = await db.collection("services").doc(serviceId).get();
    if (!docSnap.exists) continue;
    const serviceData = (docSnap.data() ?? {}) as Record<string, unknown>;

    if (normalizedEmpresa) {
      const serviceCompany = extractServiceCompany(serviceData);
      if (serviceCompany && serviceCompany !== normalizedEmpresa) continue;
    }
    seen.add(docSnap.id);
  }

  return Array.from(seen);
}

function isTokenActive(data: unknown) {
  const record = asRecord(data);
  if (!record) return true;
  if (typeof record.active === "boolean") return record.active;
  const status = typeof record.status === "string" ? record.status.toLowerCase() : "";
  if (!status) return true;
  return status === "active" || status === "ativo" || status === "aberto";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = (searchParams.get("token") || "").trim().toUpperCase();

  if (!token) {
    return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
  }

  try {
    const adminDb = getAdminDbOrThrow();
    const collectionRef = adminDb.collection("accessTokens");
    let doc: DocumentSnapshot | QueryDocumentSnapshot | null = null;

    const direct = await collectionRef.doc(token).get();
    if (direct.exists) {
      doc = direct;
    }

    if (!doc) {
      const snap = await collectionRef.where("code", "==", token).limit(1).get();
      doc = snap.docs[0] ?? null;
    }

    if (!doc) {
      const legacy = await collectionRef.where("token", "==", token).where("active", "==", true).limit(1).get();
      doc = legacy.docs[0] ?? null;
    }

    if (!doc) {
      return NextResponse.json({ ok: true, found: false, serviceIds: [] });
    }

    const data = doc.data() ?? {};
    if (!isTokenActive(data)) {
      return NextResponse.json({ ok: true, found: false, serviceIds: [] });
    }

    const { serviceId, folderId, empresa } = extractTokenData(data, doc.id);
    if (serviceId) {
      return NextResponse.json({
        ok: true,
        found: true,
        serviceIds: [serviceId],
        targetType: "service",
        targetId: serviceId,
      });
    }

    if (folderId) {
      const serviceIds = await fetchFolderServicesAdmin(adminDb, folderId, empresa);
      return NextResponse.json({
        ok: true,
        // tokens de subpacote devem redirecionar mesmo sem serviços abertos
        found: true,
        serviceIds,
        targetType: "folder",
        targetId: folderId,
      });
    }

    return NextResponse.json({ ok: true, found: false, serviceIds: [], targetType: undefined, targetId: null });
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error("[validate-token] Firebase Admin não configurado", error);
      return NextResponse.json(
        { ok: false, error: "Configuração de acesso ao banco indisponível." },
        { status: 500 },
      );
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn("[validate-token] Falha ao validar token", error);
      return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
    }

    console.error("[validate-token] Erro inesperado", error);
    return NextResponse.json({ ok: false, error: "validate_failed" }, { status: 500 });
  }
}
