export type PackageServiceSelection = {
  folderServiceIds: string[];
  missingServiceIds: string[];
  hasOverflow: boolean;
};

/**
 * Resolves the services referenced directly by subpackages without relying on
 * the (occasionally stale) aggregate array stored in the package document.
 */
export function selectMissingFolderServices(
  folderServiceLists: ReadonlyArray<ReadonlyArray<string>>,
  loadedServiceIds: Iterable<string>,
  maximumServices: number,
): PackageServiceSelection {
  const loaded = new Set(Array.from(loadedServiceIds, (id) => id.trim()).filter(Boolean));
  const folderServiceIds = Array.from(
    new Set(folderServiceLists.flatMap((ids) => ids.map((id) => id.trim()).filter(Boolean))),
  );
  const missing = folderServiceIds.filter((id) => !loaded.has(id));
  const capacity = Math.max(0, Math.floor(maximumServices) - loaded.size);

  return {
    folderServiceIds,
    missingServiceIds: missing.slice(0, capacity),
    hasOverflow: missing.length > capacity,
  };
}
