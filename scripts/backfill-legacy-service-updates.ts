import { FieldPath } from "firebase-admin/firestore";
import { db, dryRun, PAGE_SIZE } from "./backfill-common.ts";
import { FIRESTORE_SAFE_BATCH_WRITES } from "../src/lib/firestoreWriteLimits.ts";

export async function detectLegacyServiceUpdates(
  serviceRef: FirebaseFirestore.DocumentReference,
): Promise<boolean> {
  const snapshot = await serviceRef.collection("serviceUpdates").limit(1).get();
  return !snapshot.empty;
}

async function run() {
  let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
  let servicesRead = 0;
  let legacyQueries = 0;
  let markedTrue = 0;
  let markedFalse = 0;
  let writesNeeded = 0;
  let writesCommitted = 0;

  do {
    let query = db.collection("services").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
    if (cursor) query = query.startAfter(cursor);
    const page = await query.get();
    if (page.empty) break;
    servicesRead += page.size;

    const changes: Array<{ ref: FirebaseFirestore.DocumentReference; value: boolean }> = [];
    for (const service of page.docs) {
      const hasLegacy = await detectLegacyServiceUpdates(service.ref);
      legacyQueries += 1;
      if (hasLegacy) markedTrue += 1;
      else markedFalse += 1;
      if (service.get("hasLegacyServiceUpdates") !== hasLegacy) {
        changes.push({ ref: service.ref, value: hasLegacy });
      }
    }

    writesNeeded += changes.length;
    if (!dryRun) {
      for (let offset = 0; offset < changes.length; offset += FIRESTORE_SAFE_BATCH_WRITES) {
        const batch = db.batch();
        const chunk = changes.slice(offset, offset + FIRESTORE_SAFE_BATCH_WRITES);
        chunk.forEach(({ ref, value }) => batch.update(ref, { hasLegacyServiceUpdates: value }));
        await batch.commit();
        writesCommitted += chunk.length;
      }
    }

    cursor = page.docs.at(-1) ?? null;
    console.log("Progresso", {
      servicesRead,
      legacyQueries,
      markedTrue,
      markedFalse,
      writesNeeded,
      writesCommitted,
      dryRun,
    });
  } while (cursor);
}

if (process.argv[1]?.includes("backfill-legacy-service-updates")) {
  run().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
