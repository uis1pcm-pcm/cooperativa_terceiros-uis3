export type FolderServiceSource = {
  services?: unknown;
  serviceIds?: unknown;
  servicos?: unknown;
};

function sanitizeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

export function collectFolderServiceIds(source?: FolderServiceSource | null): string[] {
  if (!source) {
    return [];
  }
  const buckets = [source.services, source.serviceIds, source.servicos];
  const unique = new Set<string>();

  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const entry of bucket) {
      const id = sanitizeId(entry);
      if (id) {
        unique.add(id);
      }
    }
  }

  const result = Array.from(unique);
  return result;
}
