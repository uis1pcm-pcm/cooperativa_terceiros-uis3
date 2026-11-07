import { FieldValue } from "firebase-admin/firestore";
import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { getAdminDbOrThrow } from "@/lib/serverDb";

export async function POST(request: Request) {
  try {
    await requirePcmUser(request);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 401;
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ ok: false, error: "Dados inválidos." }, { status: 400 });
  }

  const payload = body as Record<string, unknown>;
  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const plannedStart = typeof payload.plannedStart === "string" ? payload.plannedStart.trim() : "";
  const plannedEnd = typeof payload.plannedEnd === "string" ? payload.plannedEnd.trim() : "";
  if (!name || !plannedStart || !plannedEnd) {
    return NextResponse.json({ ok: false, error: "Nome e datas são obrigatórios." }, { status: 400 });
  }

  try {
    const db = getAdminDbOrThrow();
    const description =
      typeof payload.description === "string" && payload.description.trim()
        ? payload.description.trim()
        : null;
    const ref = await db.collection("packages").add({
      nome: name,
      name,
      descricao: description,
      description,
      status: "Aberto",
      plannedStart,
      plannedEnd,
      dataInicio: plannedStart,
      dataFim: plannedEnd,
      inicioPlanejado: plannedStart,
      fimPlanejado: plannedEnd,
      createdAt: FieldValue.serverTimestamp(),
    });
    return NextResponse.json({ ok: true, packageId: ref.id });
  } catch (error) {
    console.error("[api/pcm/packages] Falha ao criar pacote", error);
    return NextResponse.json({ ok: false, error: "Não foi possível criar o pacote." }, { status: 500 });
  }
}
