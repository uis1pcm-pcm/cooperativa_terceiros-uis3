import { NextResponse } from "next/server";
import { Timestamp, getFirestore } from "firebase-admin/firestore";
import { customAlphabet } from "nanoid";

import { getAdminApp } from "@/lib/firebaseAdmin";
import { HttpError, requirePcmUser } from "../_lib/auth";

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const generate = customAlphabet(alphabet, 10);

function randomLengthToken(): string {
  const length = 8 + Math.floor(Math.random() * 3);
  return generate().slice(0, length);
}

type CreateTokenBody = {
  targetType?: string;
  targetId?: unknown;
  company?: unknown;
  expiresAt?: unknown;
  packageId?: unknown;
  pacoteId?: unknown;
  folderId?: unknown;
  pastaId?: unknown;
};

function parseBody(body: CreateTokenBody): {
  targetType: "service" | "folder";
  targetId: string;
  company?: string;
  expiresAt?: Timestamp;
  packageId?: string;
} {
  const { targetType, targetId, company, expiresAt } = body;

  if (targetType !== "service" && targetType !== "folder") {
    throw new HttpError(400, "targetType inválido");
  }

  if (typeof targetId !== "string" || !targetId.trim()) {
    throw new HttpError(400, "targetId inválido");
  }

  if (company !== undefined && (typeof company !== "string" || !company.trim())) {
    throw new HttpError(400, "company inválida");
  }

  let expiresAtTimestamp: Timestamp | undefined;
  if (expiresAt !== undefined) {
    if (typeof expiresAt !== "string" || !expiresAt.trim()) {
      throw new HttpError(400, "expiresAt deve ser string ISO");
    }
    const date = new Date(expiresAt);
    if (Number.isNaN(date.getTime())) {
      throw new HttpError(400, "expiresAt inválido");
    }
    expiresAtTimestamp = Timestamp.fromDate(date);
  }

  const companyValue = typeof company === "string" ? company.trim() : undefined;

  let packageId: string | undefined;
  if (typeof body.packageId === "string" && body.packageId.trim()) {
    packageId = body.packageId.trim();
  } else if (typeof body.pacoteId === "string" && body.pacoteId.trim()) {
    packageId = body.pacoteId.trim();
  }

  return {
    targetType,
    targetId: targetId.trim(),
    company: companyValue,
    expiresAt: expiresAtTimestamp,
    packageId,
  };
}

async function persistToken(
  db: FirebaseFirestore.Firestore,
  data: {
    targetType: "service" | "folder";
    targetId: string;
    company?: string;
    expiresAt?: Timestamp;
    packageId?: string;
  },
): Promise<string> {
  const col = db.collection("accessTokens");

  for (let attempt = 0; attempt < 5; attempt++) {
    const token = randomLengthToken();
    const normalizedCompany = data.company?.trim();
    const payload: Record<string, unknown> = {
      code: token,
      token,
      targetType: data.targetType,
      targetId: data.targetId,
      active: true,
      status: "active",
      createdAt: Timestamp.now(),
    };

    if (data.expiresAt) payload.expiresAt = data.expiresAt;
    if (normalizedCompany) {
      payload.company = normalizedCompany;
      payload.companyId = normalizedCompany;
      payload.empresa = normalizedCompany;
      payload.empresaId = normalizedCompany;
    }

    if (data.targetType === "service") {
      payload.serviceId = data.targetId;
    } else {
      payload.folderId = data.targetId;
      payload.pastaId = data.targetId;
      if (data.packageId) {
        payload.packageId = data.packageId;
        payload.pacoteId = data.packageId;
      }
    }

    try {
      await col.doc(token).create(payload);
      return token;
    } catch (err: unknown) {
      const error = err as { code?: unknown; details?: unknown; message?: unknown };
      const code = typeof error.code === "string" || typeof error.code === "number" ? String(error.code) : undefined;
      const details = typeof error.details === "string" ? error.details : undefined;
      const message = typeof error.message === "string" ? error.message : undefined;
      const alreadyExists =
        code === "6" ||
        code === "ALREADY_EXISTS" ||
        code === "already-exists" ||
        details === "ALREADY_EXISTS" ||
        /already exists/i.test(message ?? "");
      if (alreadyExists) {
        continue;
      }
      console.error("[tokens/create] Falha ao criar token", err);
      throw new HttpError(500, "Falha ao criar token");
    }
  }

  throw new HttpError(500, "Não foi possível gerar token único");
}

export async function POST(req: Request) {
  try {
    await requirePcmUser(req);

    const body = (await req.json().catch(() => ({}))) as CreateTokenBody;
    const parsed = parseBody(body);

    const app = getAdminApp();
    if (!app) {
      return NextResponse.json({ error: "Firebase Admin indisponível" }, { status: 503 });
    }

    const db = getFirestore(app);

    const token = await persistToken(db, parsed);
    const link = `/acesso?token=${token}`;

    return NextResponse.json({ token, link });
  } catch (err: unknown) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }

    console.error("[tokens/create] Erro inesperado", err);
    return NextResponse.json({ error: "Erro interno" }, { status: 500 });
  }
}
