import { NextResponse } from "next/server";

import { getTokenCookie } from "@/lib/tokenSession";
import { getServicesForToken, getTokenDoc } from "@/lib/terceiroService";
import { AdminDbUnavailableError } from "@/lib/serverDb";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  try {
    const token = await getTokenCookie();
    if (!token) {
      return NextResponse.json({ ok: false, error: "missing_token" }, { status: 401 });
    }

    const tokenDoc = await getTokenDoc(token);
    if (!tokenDoc) {
      return NextResponse.json({ ok: false, error: "token_not_found" }, { status: 404 });
    }

    const companyId =
      (typeof tokenDoc.companyId === "string" && tokenDoc.companyId.trim()) ||
      (typeof tokenDoc.empresa === "string" && tokenDoc.empresa.trim()) ||
      (typeof tokenDoc.company === "string" && tokenDoc.company.trim()) ||
      null;

    const services = await getServicesForToken(token);

    return NextResponse.json({ ok: true, companyId, services });
  } catch (error) {
    if (error instanceof AdminDbUnavailableError || (error instanceof Error && error.message === "FIREBASE_ADMIN_NOT_CONFIGURED")) {
      console.error("[api/terceiro/session] Firebase Admin não configurado", error);
      return NextResponse.json({ ok: false, error: "Configuração de acesso ao banco indisponível." }, { status: 500 });
    }

    const mapped = mapFirestoreError(error);
    if (mapped) {
      console.warn("[api/terceiro/session] Falha ao consultar dados", error);
      return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
    }

    console.error("[api/terceiro/session] Erro inesperado", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
