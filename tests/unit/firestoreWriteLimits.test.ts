import { describe, expect, it } from "vitest";

import {
  FIRESTORE_SAFE_BATCH_WRITES,
  MAX_ATOMIC_PACKAGE_SERVICES,
  planPackageCreationWrites,
} from "@/lib/firestoreWriteLimits";

describe("Firestore package write limits", () => {
  it.each([
    [50, true, [51]],
    [200, true, [201]],
    [499, true, [500]],
    [500, false, [1, 400, 100, 1]],
    [620, false, [1, 400, 220, 1]],
  ])("plans %i services without exceeding the write limit", (services, atomic, writes) => {
    const plan = planPackageCreationWrites(services);
    expect(plan).toEqual({ atomic, commitWriteCounts: writes });
    expect(Math.max(...plan.commitWriteCounts)).toBeLessThanOrEqual(
      atomic ? MAX_ATOMIC_PACKAGE_SERVICES + 1 : FIRESTORE_SAFE_BATCH_WRITES,
    );
  });
});
