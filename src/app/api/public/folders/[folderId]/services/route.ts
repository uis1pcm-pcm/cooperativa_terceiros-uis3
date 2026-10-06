import { NextResponse } from "next/server";

import { requireFolderAccess } from "@/lib/public-access";
import { toPublicSubpackageService } from "@/lib/subpackageServices";
import { mapFirestoreError } from "@/lib/utils/firestoreErrors";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { folderId: string } }) {
  const token = new URL(req.url).searchParams.get("token")?.trim().toUpperCase() ?? "";
  if (!token) {
    return NextResponse.json({ ok: false, error: "Token não informado." }, { status: 400 });
  }

  try {
    const { services } = await requireFolderAccess(token, params.folderId);
    return NextResponse.json(
      { ok: true, services: services.map(toPublicSubpackageService) },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (error) {
    if (error instanceof Error && "status" in error) {
      const status = (error as { status?: number }).status ?? 403;
      return NextResponse.json({ ok: false, error: error.message }, { status });
    }
    const mapped = mapFirestoreError(error);
    if (mapped) {
      return NextResponse.json({ ok: false, error: mapped.message }, { status: mapped.status });
    }
    console.error(`[api/public/folders/${params.folderId}/services] Falha ao atualizar serviços`, error);
    return NextResponse.json({ ok: false, error: "Não foi possível atualizar os serviços." }, { status: 500 });
  }
}
