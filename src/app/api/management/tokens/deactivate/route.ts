import { NextResponse } from "next/server";
import { getFirestore } from "firebase-admin/firestore";

import { getAdminApp } from "@/lib/firebaseAdmin";
import { HttpError, requirePcmUser } from "../_lib/auth";

type DeactivateBody = {
  token?: unknown;
};

function parseBody(body: DeactivateBody): string {
  if (!body || typeof body.token !== "string" || !body.token.trim()) {
    throw new HttpError(400, "token inválido");
  }
  return body.token.trim();
}

export async function POST(req: Request) {
  try {
    await requirePcmUser(req);

    const body = (await req.json().catch(() => ({}))) as DeactivateBody;
    const token = parseBody(body);

    const app = getAdminApp();
    if (!app) {
      return NextResponse.json({ error: "Firebase Admin indisponível" }, { status: 503 });
    }

    const db = getFirestore(app);
    const ref = db.collection("accessTokens").doc(token);
    const snap = await ref.get();
    if (!snap.exists) {
      throw new HttpError(404, "Token não encontrado");
    }

    await ref.update({ active: false });

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[tokens/deactivate] Erro inesperado", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
