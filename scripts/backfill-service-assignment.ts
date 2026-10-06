import { FieldPath } from "firebase-admin/firestore";
import { db, dryRun, PAGE_SIZE, BATCH_SIZE } from "./backfill-common.ts";
import { buildServiceAssignmentFields, resolveServiceAssignment } from "../src/lib/serviceAssignment.ts";

(async () => {
const [packages, folders] = await Promise.all([db.collection("packages").get(), db.collection("packageFolders").get()]);
const packageMembers = new Map<string, Set<string>>(), folderMembers = new Map<string, Array<{ folderId: string; packageId: string }>>();
for (const doc of packages.docs) for (const value of [...(doc.get("serviceIds") ?? []), ...(doc.get("services") ?? [])]) {
  if (typeof value !== "string") continue; const set = packageMembers.get(value) ?? new Set(); set.add(doc.id); packageMembers.set(value, set);
}
for (const doc of folders.docs) for (const value of [...(doc.get("serviceIds") ?? []), ...(doc.get("services") ?? []), ...(doc.get("servicos") ?? [])]) {
  if (typeof value !== "string") continue; const list = folderMembers.get(value) ?? []; list.push({ folderId: doc.id, packageId: String(doc.get("packageId") ?? doc.get("pacoteId") ?? "") }); folderMembers.set(value, list);
}
let cursor: FirebaseFirestore.QueryDocumentSnapshot | null = null;
let read = packages.size + folders.size, changed = 0, written = 0, conflicts = 0;
do {
  let query = db.collection("services").orderBy(FieldPath.documentId()).limit(PAGE_SIZE); if (cursor) query = query.startAfter(cursor);
  const page = await query.get(); if (page.empty) break; read += page.size; const updates: Array<{ ref: FirebaseFirestore.DocumentReference; fields: Record<string, unknown> }> = [];
  for (const doc of page.docs) {
    const data = doc.data(); const own = resolveServiceAssignment(data); const foldersForService = folderMembers.get(doc.id) ?? []; const packagesForService = packageMembers.get(doc.id) ?? new Set();
    const aliasConflict = (typeof data.packageId === "string" && typeof data.pacoteId === "string" && data.packageId !== data.pacoteId) || (typeof data.folderId === "string" && typeof data.pastaId === "string" && data.folderId !== data.pastaId);
    if (aliasConflict || foldersForService.length > 1 || packagesForService.size > 1) { conflicts += 1; console.warn(`CONFLITO ${doc.id}`); continue; }
    const folder = foldersForService[0]; const packageId = folder?.packageId || [...packagesForService][0] || own.packageId; const folderId = folder?.folderId || own.folderId;
    if (folderId && !folder && own.folderId) { conflicts += 1; console.warn(`CONFLITO ${doc.id}: folder inexistente/não referenciado`); continue; }
    const fields = buildServiceAssignmentFields({ packageId: packageId || null, folderId: folderId || null });
    if (Object.entries(fields).some(([key, value]) => (data[key] ?? null) !== value)) updates.push({ ref: doc.ref, fields });
  }
  changed += updates.length;
  if (!dryRun) for (let i = 0; i < updates.length; i += BATCH_SIZE) { const batch = db.batch(); const slice = updates.slice(i, i + BATCH_SIZE); slice.forEach(({ ref, fields }) => batch.update(ref, fields)); await batch.commit(); written += slice.length; }
  cursor = page.docs.at(-1) ?? null; console.log(`Progresso: ${read} leituras totais, ${changed} divergentes, ${conflicts} conflitos, ${written} gravados`);
} while (cursor);
console.log({ dryRun, read, changed, conflicts, written });
})().catch((error) => { console.error(error); process.exitCode = 1; });
