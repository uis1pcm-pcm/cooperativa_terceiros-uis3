import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { getAdminDbOrThrow } from "@/lib/serverDb";
import { decodeRouteParam } from "@/lib/decodeRouteParam";

function serialize(value: unknown): unknown {
  if (value instanceof Timestamp) return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, nested]) => [key, serialize(nested)]),
    );
  }
  return value;
}

async function authorize(request: Request) {
  try {
    await requirePcmUser(request);
    return null;
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 401;
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status });
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  const authError = await authorize(request);
  if (authError) return authError;

  const { serviceId: rawServiceId } = await context.params;
  const serviceId = decodeRouteParam(rawServiceId);
  if (!serviceId) return NextResponse.json({ ok: false, error: "invalid_service_id" }, { status: 400 });

  try {
    const db = getAdminDbOrThrow();
    const serviceRef = db.collection("services").doc(serviceId);
    const [serviceSnap, packageSnap, updatesSnap, legacyUpdatesSnap] = await Promise.all([
      serviceRef.get(),
      db.collection("packages").orderBy("nome", "asc").get(),
      serviceRef.collection("updates").orderBy("createdAt", "desc").limit(50).get(),
      serviceRef.collection("serviceUpdates").orderBy("date", "desc").limit(50).get(),
    ]);

    if (!serviceSnap.exists) {
      return NextResponse.json({ ok: false, error: "service_not_found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      service: serialize({ id: serviceSnap.id, ...serviceSnap.data() }),
      packages: packageSnap.docs.map((doc) => ({
        id: doc.id,
        nome: String(doc.get("nome") ?? doc.get("name") ?? ""),
      })),
      updates: updatesSnap.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })),
      legacyUpdates: legacyUpdatesSnap.docs.map((doc) => serialize({ id: doc.id, ...doc.data() })),
    });
  } catch (error) {
    console.error(`[api/pcm/servicos/${serviceId}/edit-data] Falha ao carregar dados`, error);
    return NextResponse.json({ ok: false, error: "Não foi possível carregar os dados do serviço." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ serviceId: string }> },
) {
  const authError = await authorize(request);
  if (authError) return authError;

  const { serviceId: rawServiceId } = await context.params;
  const serviceId = decodeRouteParam(rawServiceId);
  if (!serviceId) return NextResponse.json({ ok: false, error: "invalid_service_id" }, { status: 400 });

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "invalid_payload" }, { status: 400 });
  }

  const input = body as Record<string, unknown>;
  const stringFields = ["os", "tag", "equipamento", "equipmentName", "status", "displayStatus"];
  for (const field of stringFields) {
    if (Object.prototype.hasOwnProperty.call(input, field) && typeof input[field] !== "string") {
      return NextResponse.json({ ok: false, error: `invalid_${field}` }, { status: 400 });
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, "checklist") && !Array.isArray(input.checklist)) {
    return NextResponse.json({ ok: false, error: "invalid_checklist" }, { status: 400 });
  }
  const start = input.inicioPrevisto === undefined ? null : Number(input.inicioPrevisto);
  const end = input.fimPrevisto === undefined ? null : Number(input.fimPrevisto);
  const hours = input.horasPrevistas === undefined ? null : Number(input.horasPrevistas);
  if (
    (start !== null && !Number.isFinite(start)) ||
    (end !== null && !Number.isFinite(end)) ||
    (start !== null && end !== null && start > end) ||
    (hours !== null && (!Number.isFinite(hours) || hours <= 0))
  ) {
    return NextResponse.json({ ok: false, error: "invalid_schedule" }, { status: 400 });
  }

  const allowedFields = [
    "os", "oc", "tag", "equipamento", "equipmentName", "setor", "empresaId", "company", "cnpj",
    "status", "displayStatus", "pacoteId", "packageId", "horasPrevistas", "checklist", "andamento", "previousProgress",
    "progress", "realPercent", "realPercentSnapshot", "manualPercent", "percent", "percentualRealAtual",
  ];
  const update: Record<string, unknown> = {};
  for (const field of allowedFields) {
    if (Object.prototype.hasOwnProperty.call(input, field)) update[field] = input[field];
  }
  if (start !== null) update.inicioPrevisto = Timestamp.fromMillis(start);
  if (end !== null) update.fimPrevisto = Timestamp.fromMillis(end);
  update.updatedAt = FieldValue.serverTimestamp();
  if (input.lastProgressUpdateAt !== undefined || input.lastUpdateDate !== undefined) {
    update.lastProgressUpdateAt = FieldValue.serverTimestamp();
    update.lastUpdateDate = FieldValue.serverTimestamp();
  }

  try {
    const db = getAdminDbOrThrow();
    const ref = db.collection("services").doc(serviceId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return NextResponse.json({ ok: false, error: "service_not_found" }, { status: 404 });
    await ref.update(update);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(`[api/pcm/servicos/${serviceId}/edit-data] Falha ao salvar`, error);
    return NextResponse.json({ ok: false, error: "Não foi possível salvar as alterações." }, { status: 500 });
  }
}
