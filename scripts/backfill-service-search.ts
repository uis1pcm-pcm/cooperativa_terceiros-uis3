import { FieldPath } from "firebase-admin/firestore";
import { db, dryRun, PAGE_SIZE, BATCH_SIZE } from "./backfill-common.ts";
import { buildServiceSearchTokens } from "../src/lib/serviceSearch.ts";

(async () => {
let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
let read = 0, changed = 0, written = 0;
do {
  let query = db.collection("services").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get(); if (page.empty) break; read += page.size;
  const updates = page.docs.flatMap((doc) => {
    const expected = buildServiceSearchTokens(doc.id, doc.data());
    const current = Array.isArray(doc.get("searchTokens")) ? [...doc.get("searchTokens")].sort() : [];
    return JSON.stringify([...expected].sort()) === JSON.stringify(current) ? [] : [{ ref: doc.ref, expected }];
  });
  changed += updates.length;
  if (!dryRun) for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch(); const slice = updates.slice(i, i + BATCH_SIZE);
    slice.forEach(({ ref, expected }) => batch.update(ref, { searchTokens: expected })); await batch.commit(); written += slice.length;
  }
  cursor = page.docs.at(-1) ?? null; console.log(`Progresso: ${read} lidos, ${changed} divergentes, ${written} gravados`);
} while (cursor);
console.log({ dryRun, read, changed, written });
})().catch((error) => { console.error(error); process.exitCode = 1; });
