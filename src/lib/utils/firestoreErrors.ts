export type FirestoreErrorInfo = {
  status: number;
  message: string;
};

function extractErrorCode(error: unknown): string | null {
  if (!error || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  if (typeof code === "string" && code.trim()) {
    return code.trim();
  }
  return null;
}

export function mapFirestoreError(error: unknown): FirestoreErrorInfo | null {
  const code = extractErrorCode(error);
  if (code === "permission-denied") {
    return { status: 403, message: "Sem permissão para acessar este recurso." };
  }
  if (code === "not-found") {
    return { status: 404, message: "Recurso não encontrado." };
  }

  if (error instanceof Error) {
    if (/Missing or insufficient permissions/i.test(error.message)) {
      return { status: 403, message: "Sem permissão para acessar este recurso." };
    }
    if (/No document to update/i.test(error.message) || /not found/i.test(error.message)) {
      return { status: 404, message: "Recurso não encontrado." };
    }
  }

  return null;
}
