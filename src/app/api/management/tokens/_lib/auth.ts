import { getAuth, type DecodedIdToken } from "firebase-admin/auth";

import { getAdminApp } from "@/lib/firebaseAdmin";
import { verifyFirebaseIdToken } from "@/lib/firebaseIdentity";
import { isPCMUser } from "@/lib/pcmAuth";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export type AuthenticatedUser = {
  uid: string;
  email: string;
  token?: DecodedIdToken;
};

export async function requirePcmUser(req: Request): Promise<AuthenticatedUser> {
  const header = req.headers.get("authorization");
  if (!header) {
    throw new HttpError(401, "Authorization header ausente");
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new HttpError(401, "Formato do header Authorization inválido");
  }

  const bearerToken = match[1]!.trim();
  if (!bearerToken) {
    throw new HttpError(401, "Token inválido");
  }

  const app = getAdminApp();
  if (app) {
    try {
      const decoded = await getAuth(app).verifyIdToken(bearerToken);
      const email = decoded.email;
      if (!email) {
        throw new HttpError(401, "Token não possui e-mail associado");
      }

      if (!isPCMUser(email)) {
        console.error("[requirePcmUser] Usuário não autorizado", { email });
        throw new HttpError(401, "Usuário não autorizado");
      }

      return { uid: decoded.uid, email: email.toLowerCase(), token: decoded };
    } catch (err: unknown) {
      console.error("[requirePcmUser] Falha ao verificar token com Firebase Admin", err);
    }
  } else {
    console.warn("[requirePcmUser] Firebase Admin não configurado. Utilizando fallback Identity Toolkit.");
  }

  const fallback = await verifyFirebaseIdToken(bearerToken);
  if (!fallback) {
    throw new HttpError(app ? 401 : 503, app ? "Token inválido" : "Autenticação PCM indisponível");
  }

  const email = fallback.email;
  if (!email) {
    throw new HttpError(401, "Token não possui e-mail associado");
  }

  if (!isPCMUser(email)) {
    console.error("[requirePcmUser] Usuário não autorizado (fallback)", { email });
    throw new HttpError(401, "Usuário não autorizado");
  }

  return { uid: fallback.uid, email: email.toLowerCase() };
}
