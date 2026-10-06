export type TokenStateData = {
  active?: unknown;
  status?: unknown;
  revoked?: unknown;
  expiresAtMillis?: number;
};

export function isCanonicalTokenActive(data: TokenStateData, now: number): boolean {
  if (data.active === false || data.revoked === true) return false;
  const status = typeof data.status === "string" ? data.status.trim().toLowerCase() : undefined;
  if (status === "revoked" || status === "inactive") return false;
  return data.expiresAtMillis == null || data.expiresAtMillis >= now;
}
