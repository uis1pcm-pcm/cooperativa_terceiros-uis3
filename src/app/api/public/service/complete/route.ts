import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { HttpError, requirePcmUser } from "@/app/api/management/tokens/_lib/auth";
import { PublicAccessError, requireServiceAccess } from "@/lib/public-access";
import { addComputedUpdate } from "@/lib/repo/services";

export async function POST(req: Request) {
  const { searchParams } = new URL(req.url);
  const serviceId = searchParams.get("serviceId")?.trim() ?? "";
  const queryToken = searchParams.get("token");

  if (!serviceId) {
    return NextResponse.json({ ok: false, error: "serviceId inválido." }, { status: 400 });
  }

  const cookieStore = await cookies();
  const cookieToken = cookieStore.get("access_token")?.value ?? "";
  const token = queryToken && queryToken.trim() ? queryToken.trim() : cookieToken;

  try {
    const user = await requirePcmUser(req);
    await addComputedUpdate(serviceId, 100, "Concluído pelo PCM");
    return NextResponse.json({ ok: true, completedBy: user.email });
  } catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 403)) {
      // Fall through to public/token handling below
    } else if (error && !(error instanceof PublicAccessError)) {
      console.error("[public/service/complete] Falha ao concluir serviço (PCM)", error);
      const message = error instanceof Error ? error.message : "Não foi possível concluir o serviço.";
      return NextResponse.json({ ok: false, error: message }, { status: 500 });
    }
  }

  try {
    await requireServiceAccess(token, serviceId);
    return NextResponse.json(
      { ok: false, error: "Conclusão permitida apenas para usuários PCM." },
      { status: 403 },
    );
  } catch (error) {
    if (error instanceof PublicAccessError) {
      return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
    }

    console.error("[public/service/complete] Falha ao concluir serviço", error);
    const message = error instanceof Error ? error.message : "Não foi possível concluir o serviço.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
