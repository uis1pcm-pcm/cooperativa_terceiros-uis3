import {
  PCM_SESSION_COOKIE_NAME,
  verifyPcmSessionToken,
} from "@/lib/auth/pcmSession";

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "HttpError";
  }
}

export type AuthenticatedUser = {
  uid: string;
  email: string;
};

export async function requirePcmUser(req: Request): Promise<AuthenticatedUser> {
  const cookieHeader = req.headers.get("cookie") ?? "";
  const sessionCookie = cookieHeader
    .split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(`${PCM_SESSION_COOKIE_NAME}=`))
    ?.slice(PCM_SESSION_COOKIE_NAME.length + 1);
  const session = verifyPcmSessionToken(sessionCookie);

  if (!session) {
    throw new HttpError(401, "Sessão PCM inválida ou expirada");
  }

  return { uid: "pcm-fixed-login", email: session.email };
}
