import { NextResponse } from "next/server";
import { getAuth } from "firebase-admin/auth";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { getAdminApp } from "@/lib/firebaseAdmin";
import { decodeRouteParam } from "@/lib/decodeRouteParam";
import { ensureServiceAccessToken } from "@/lib/repo/accessTokens";
import { getChecklist, getService, getServiceById, listUpdates } from "@/lib/repo/services";
import type { ChecklistItem, Service, ServiceUpdate } from "@/lib/types";

function extractBearerToken(req: Request): string | null {
  const header = req.headers.get("authorization");
  if (!header) return null;
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1]?.trim();
  return token && token.length > 0 ? token : null;
}

async function ensureThirdPartyAccess(token: string, serviceId: string): Promise<boolean> {
  const app = getAdminApp();
  if (!app) {
    return false;
  }

  try {
    const decoded = await getAuth(app).verifyIdToken(token, true);
    if (decoded.role !== "third") {
      return false;
    }

    const directServiceId = typeof decoded.serviceId === "string" ? decoded.serviceId.trim() : "";
    if (directServiceId && directServiceId === serviceId) {
      return true;
    }

    if (Array.isArray(decoded.serviceIds)) {
      const allowed = decoded.serviceIds
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .filter((value) => value.length > 0);
      if (allowed.includes(serviceId)) {
        return true;
      }
    }

    if (decoded.serviceAccess && typeof decoded.serviceAccess === "object") {
      const record = decoded.serviceAccess as Record<string, unknown>;
      const flag = record[serviceId];
      if (flag === true || flag === serviceId) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error("[servicos/fallback] Falha ao verificar token third-party", error);
    return false;
  }
}

type SuccessResponse = {
  ok: true;
  service: Service | null;
  legacyService: Service | null;
  checklist: ChecklistItem[];
  updates: ServiceUpdate[];
  latestToken: { code: string; company?: string | null } | null;
};

type ErrorResponse = { ok: false; error: string };

export async function GET(
  req: Request,
  context: { params: Promise<{ serviceId: string }> },
): Promise<NextResponse<SuccessResponse | ErrorResponse>> {
  const { serviceId } = await context.params;
  const decodedServiceId = decodeRouteParam(serviceId);
  const serviceIdCandidates = Array.from(
    new Set([decodedServiceId, serviceId].filter((value) => typeof value === "string" && value.length > 0)),
  );

  if (serviceIdCandidates.length === 0) {
    return NextResponse.json({ ok: false, error: "missing_service_id" }, { status: 400 });
  }

  const bearerToken = extractBearerToken(req);
  if (!bearerToken) {
    return NextResponse.json({ ok: false, error: "missing_authorization" }, { status: 401 });
  }

  let authorized = false;

  try {
    await requirePcmUser(req);
    authorized = true;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      for (const candidate of serviceIdCandidates) {
        authorized = await ensureThirdPartyAccess(bearerToken, candidate);
        if (authorized) break;
      }
      if (!authorized) {
        return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
      }
    } else if (error instanceof HttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    } else {
      console.error("[servicos/fallback] Falha inesperada ao validar usuário", error);
      return NextResponse.json({ ok: false, error: "auth_validation_failed" }, { status: 500 });
    }
  }

  if (!authorized) {
    return NextResponse.json({ ok: false, error: "not_allowed" }, { status: 403 });
  }

  try {
    let service: Awaited<ReturnType<typeof getServiceById>> | null = null;
    let legacyService: Awaited<ReturnType<typeof getService>> | null = null;
    let resolvedServiceId = serviceIdCandidates[0];

    for (const candidate of serviceIdCandidates) {
      const [candidateService, candidateLegacy] = await Promise.all([
        getServiceById(candidate),
        getService(candidate),
      ]);

      if (candidateService || candidateLegacy) {
        service = candidateService;
        legacyService = candidateLegacy;
        resolvedServiceId = candidateService?.id ?? candidateLegacy?.id ?? candidate;
        break;
      }
    }

    const baseService = service ?? legacyService;
    if (!baseService) {
      return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    }

    const [checklist, updates, latestToken] = await Promise.all([
      getChecklist(resolvedServiceId).catch(() => [] as ChecklistItem[]),
      listUpdates(resolvedServiceId, 100).catch(() => [] as ServiceUpdate[]),
      ensureServiceAccessToken({ serviceId: baseService.id, company: baseService.company ?? undefined }).catch((tokenError) => {
        console.error(`[servicos/${resolvedServiceId}] Falha ao carregar token mais recente (fallback)`, tokenError);
        return null;
      }),
    ]);

    return NextResponse.json({
      ok: true,
      service: service ?? null,
      legacyService: legacyService ?? null,
      checklist,
      updates,
      latestToken: latestToken
        ? { code: latestToken.code, company: latestToken.company ?? null }
        : null,
    });
  } catch (error) {
    console.error(`[servicos/${serviceIdCandidates[0]}] Falha ao carregar fallback`, error);
    return NextResponse.json({ ok: false, error: "fallback_failed" }, { status: 500 });
  }
}
