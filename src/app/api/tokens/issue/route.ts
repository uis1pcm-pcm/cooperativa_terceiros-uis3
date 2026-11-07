import { NextRequest, NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { ensureServiceAccessToken } from "@/lib/repo/accessTokens";
import { getPackageFolder } from "@/lib/repo/folders";

export async function POST(req: NextRequest) {
  try {
    await requirePcmUser(req);
    const body = await req.json();

    if (!body?.scope) return NextResponse.json({ ok: false, error: "missing_scope" }, { status: 400 });

    let serviceId: string | undefined;
    let folderId: string | undefined;
    let packageId: string | undefined;
    let empresa: string | undefined;

    if (body.scope?.type === "service" && typeof body.scope?.serviceId === "string") {
      serviceId = body.scope.serviceId;
    } else if (body.scope?.type === "folder") {
      if (typeof body.scope?.folderId === "string") folderId = body.scope.folderId;
      if (typeof body.scope?.pastaId === "string") folderId = body.scope.pastaId;
      if (typeof body.scope?.packageId === "string") packageId = body.scope.packageId;
      if (typeof body.scope?.pacoteId === "string") packageId = body.scope.pacoteId;
      if (typeof body.scope?.empresaId === "string") empresa = body.scope.empresaId;
      if (typeof body.scope?.company === "string") empresa = body.scope.company;
    }

    if (!serviceId && !folderId) {
      return NextResponse.json({ ok: false, error: "unsupported_scope" }, { status: 400 });
    }

    let token: string | null = null;
    if (serviceId) {
      token = (await ensureServiceAccessToken({ serviceId, company: empresa }))?.code ?? null;
    } else if (folderId) {
      const folder = await getPackageFolder(folderId);
      token = folder?.tokenCode ?? null;
      if (folder && packageId && folder.packageId !== packageId) {
        return NextResponse.json({ ok: false, error: "folder_package_mismatch" }, { status: 403 });
      }
    }
    if (!token) {
      return NextResponse.json({ ok: false, error: "token_unavailable" }, { status: 404 });
    }
    return NextResponse.json({ ok: true, token });
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }
    console.error("[tokens/issue]", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
