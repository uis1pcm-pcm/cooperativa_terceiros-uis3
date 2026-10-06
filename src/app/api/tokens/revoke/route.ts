import { NextRequest, NextResponse } from "next/server";

import { AdminDbUnavailableError, getAdminDbOrThrow } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";

export async function POST(req: NextRequest) {
  try {
    const { token } = await req.json();
    if (!token || typeof token !== "string") {
      return NextResponse.json({ ok: false, error: "missing_token" }, { status: 400 });
    }

    const trimmed = token.trim().toUpperCase();
    const adminDb = getAdminDbOrThrow();

    const byCode = await adminDb.collection("accessTokens").where("code", "==", trimmed).limit(1).get();
    let doc = byCode.docs[0];
    if (!doc) {
      const legacy = await adminDb.collection("accessTokens").where("token", "==", trimmed).limit(1).get();
      doc = legacy.docs[0];
    }
    if (!doc) return NextResponse.json({ ok: true, found: false });
    await doc.ref.update({ active: false, status: "revoked" });
    return NextResponse.json({ ok: true, found: true });
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error("[tokens/revoke] Firebase Admin não configurado", error);
      return NextResponse.json({ ok: false, error: "Configuração de acesso ao banco indisponível." }, { status: 500 });
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn("[tokens/revoke] Falha ao atualizar token", error);
      return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
    }

    console.error("[tokens/revoke]", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
