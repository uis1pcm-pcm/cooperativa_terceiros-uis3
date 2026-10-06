export type CanonicalServiceAssignment = { packageId: string | null; folderId: string | null };

function id(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveServiceAssignment(data: Record<string, unknown>): CanonicalServiceAssignment {
  return {
    packageId: id(data.packageId) ?? id(data.pacoteId),
    folderId: id(data.folderId) ?? id(data.pastaId) ?? id(data.packageFolderId) ?? id(data.subpackageId),
  };
}

export function buildServiceAssignmentFields(assignment: CanonicalServiceAssignment) {
  return {
    packageId: assignment.packageId,
    pacoteId: assignment.packageId,
    folderId: assignment.folderId,
    pastaId: assignment.folderId,
  };
}
