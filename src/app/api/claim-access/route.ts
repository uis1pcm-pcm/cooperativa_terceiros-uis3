import { NextResponse } from "next/server";
import { PublicAccessError, resolvePublicAccessRedirect } from "@/lib/public-access";

type ValidationInput = { token?: string | null };

function extractToken(value: ValidationInput): string {
  const token = typeof value.token === "string" ? value.token.trim() : "";
  return token;
}

function buildErrorResponse(error: unknown) {
  if (error instanceof PublicAccessError) {
    return {
      body: { ok: false, error: error.message },
      init: { status: error.status },
    } as const;
  }

  console.error("claim-access: unexpected error", error);
  return {
    body: { ok: false, error: "Não foi possível validar o token." },
    init: { status: 500 },
  } as const;
}

async function handleValidation(token: string) {
  if (!token) {
    throw new PublicAccessError(400, "Token ausente");
  }

  const { redirectPath, targetType, targetId } = await resolvePublicAccessRedirect(token);

  return NextResponse.json({
    ok: true,
    redirectPath,
    targetType,
    targetId,
  });
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token")?.trim() ?? "";
    return await handleValidation(token);
  } catch (error) {
    const { body, init } = buildErrorResponse(error);
    return NextResponse.json(body, init);
  }
}

export async function POST(req: Request) {
  try {
    const payload = await req.json().catch(() => ({})) as ValidationInput;
    const token = extractToken(payload);
    return await handleValidation(token);
  } catch (error) {
    const { body, init } = buildErrorResponse(error);
    return NextResponse.json(body, init);
  }
}
