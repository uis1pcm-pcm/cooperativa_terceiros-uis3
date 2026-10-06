let cachedAllowlist: Set<string> | null | undefined;

function readAllowlist(): Set<string> | null {
  if (cachedAllowlist !== undefined) {
    return cachedAllowlist;
  }

  const rawValue =
    process.env.PCM_ALLOWED_EMAILS ||
    process.env.NEXT_PUBLIC_PCM_ALLOWED_EMAILS ||
    process.env.PCM_ALLOWLIST ||
    process.env.NEXT_PUBLIC_PCM_ALLOWLIST ||
    "";

  const entries = rawValue
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  if (entries.length === 0) {
    cachedAllowlist = null;
    return null;
  }

  if (entries.includes("*")) {
    cachedAllowlist = null;
    return null;
  }

  cachedAllowlist = new Set(entries);
  return cachedAllowlist;
}

export function isPCMUser(userEmail: string): boolean {
  const email = userEmail?.trim().toLowerCase();
  if (!email) {
    return false;
  }

  const allowlist = readAllowlist();
  if (!allowlist) {
    return true;
  }

  return allowlist.has(email);
}
