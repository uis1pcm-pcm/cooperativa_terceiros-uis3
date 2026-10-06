import { FieldPath } from "firebase-admin/firestore";
import { db, dryRun, PAGE_SIZE, BATCH_SIZE } from "./backfill-common.ts";
import { resolveCanonicalServiceStatus } from "../src/lib/serviceStatus.ts";

(async () => {
let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
let read = 0, changed = 0, written = 0;
const totals = { Aberto: 0, Pendente: 0, Concluído: 0 };
do {
  let query = db.collection("services").orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
  if (cursor) query = query.startAfter(cursor);
  const page = await query.get();
  if (page.empty) break;
  read += page.size;
  const updates: Array<{ ref: FirebaseFirestore.DocumentReference; status: keyof typeof totals }> = [];
  for (const doc of page.docs) {
    const data = doc.data();
    const status = resolveCanonicalServiceStatus({ id: doc.id, os: String(data.os ?? doc.id), equipmentName: String(data.equipmentName ?? data.equipamento ?? ""), plannedStart: "", plannedEnd: "", totalHours: 0, status: data.status ?? "Aberto", progress: Number(data.realPercent ?? data.andamento ?? data.progress ?? 0), previousProgress: data.previousProgress ?? null, createdAt: 0 });
    totals[status] += 1;
    if (data.displayStatus !== status) updates.push({ ref: doc.ref, status });
  }
  changed += updates.length;
  if (!dryRun) for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = db.batch(); const slice = updates.slice(i, i + BATCH_SIZE);
    slice.forEach(({ ref, status }) => batch.update(ref, { displayStatus: status })); await batch.commit(); written += slice.length;
  }
  cursor = page.docs.at(-1) ?? null;
  console.log(`Progresso: ${read} lidos, ${changed} divergentes, ${written} gravados`);
} while (cursor);
console.log({ dryRun, read, changed, written, ...totals });
})().catch((error) => { console.error(error); process.exitCode = 1; });
