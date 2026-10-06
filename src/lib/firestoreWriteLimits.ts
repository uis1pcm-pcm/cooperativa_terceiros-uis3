export const FIRESTORE_SAFE_BATCH_WRITES = 400;
export const MAX_ATOMIC_PACKAGE_SERVICES = 499;

export type PackageCreationWritePlan = {
  atomic: boolean;
  commitWriteCounts: number[];
};

export function planPackageCreationWrites(serviceCount: number): PackageCreationWritePlan {
  const count = Math.max(0, Math.floor(serviceCount));
  if (count <= MAX_ATOMIC_PACKAGE_SERVICES) {
    return { atomic: true, commitWriteCounts: [count + 1] };
  }

  const commitWriteCounts = [1];
  for (let offset = 0; offset < count; offset += FIRESTORE_SAFE_BATCH_WRITES) {
    commitWriteCounts.push(Math.min(FIRESTORE_SAFE_BATCH_WRITES, count - offset));
  }
  commitWriteCounts.push(1);
  return { atomic: false, commitWriteCounts };
}

export function chunkForSafeWrites<T>(items: T[]): T[][] {
  const chunks: T[][] = [];
  for (let offset = 0; offset < items.length; offset += FIRESTORE_SAFE_BATCH_WRITES) {
    chunks.push(items.slice(offset, offset + FIRESTORE_SAFE_BATCH_WRITES));
  }
  return chunks;
}
