import { NextRequest, NextResponse } from "next/server";

import { createAccessToken } from "@/lib/accessTokens";

export async function POST(req: NextRequest) {
  try {
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

    const token = await createAccessToken({ serviceId, folderId, packageId, empresa });
    return NextResponse.json({ ok: true, token });
  } catch (error) {
    console.error("[tokens/issue]", error);
    return NextResponse.json({ ok: false, error: "server_error" }, { status: 500 });
  }
}
