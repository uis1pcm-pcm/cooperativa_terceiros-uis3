const CONNECTION_RESET_TOKENS = [
  "ERR_CONNECTION_RESET",
  "ECONNRESET",
  "CONNECTION RESET",
  "CONNECTION WAS RESET",
];

const CONNECTION_CLOSED_TOKENS = [
  "CONNECTION CLOSED",
  "THE CONNECTION WAS CLOSED",
];

function extractCandidateStrings(error: unknown): string[] {
  const candidates: string[] = [];

  if (typeof error === "string") {
    candidates.push(error);
  } else if (error instanceof Error) {
    if (error.message) candidates.push(error.message);
    if (error.stack) candidates.push(error.stack);
    if (typeof (error as { cause?: unknown }).cause === "string") {
      candidates.push((error as { cause: string }).cause);
    }
  } else if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    const stack = (error as { stack?: unknown }).stack;
    const code = (error as { code?: unknown }).code;
    if (typeof message === "string") candidates.push(message);
    if (typeof stack === "string") candidates.push(stack);
    if (typeof code === "string") candidates.push(code);
  }

  return candidates;
}

function normalise(value: string): string {
  return value.trim().toUpperCase();
}

export function isConnectionResetError(error: unknown): boolean {
  const candidates = extractCandidateStrings(error)
    .map(normalise)
    .filter((candidate) => candidate.length > 0);

  for (const candidate of candidates) {
    if (CONNECTION_RESET_TOKENS.some((token) => candidate.includes(token))) {
      return true;
    }
    if (CONNECTION_CLOSED_TOKENS.some((token) => candidate.includes(token))) {
      return true;
    }
  }

  return false;
}

export default isConnectionResetError;
