import type { Firestore } from 'firebase-admin/firestore';
import { decode, type DumpDoc } from './dump';
import type { PlanWrite } from './plan';

/** Top-level collections of the new platform that a migration may add to. */
export const TARGET_COLLECTIONS = [
  'classes',
  'joinCodes',
  'studentSecrets',
  'quizzes',
  'assignments',
  'assignmentKeys',
  'submissions',
  'guestResults',
  'games',
  'gameKeys',
  'gameResults',
];

/**
 * What already exists in the new collections: classes and join codes with data
 * (matching by class name), everything else by path only (cheap to read).
 */
export async function readTarget(db: Firestore): Promise<DumpDoc[]> {
  const out: DumpDoc[] = [];
  for (const col of TARGET_COLLECTIONS) {
    if (col === 'classes') {
      const snap = await db.collection(col).get();
      for (const d of snap.docs) out.push({ path: d.ref.path, data: d.data() });
    } else {
      for (const ref of await db.collection(col).listDocuments()) {
        out.push({ path: ref.path, data: {} });
      }
    }
  }
  const roster = await db.collectionGroup('roster').select().get();
  for (const d of roster.docs) out.push({ path: d.ref.path, data: {} });
  return out;
}

/** Creates the planned documents; an existing one is left as it is. */
export async function applyPlan(db: Firestore, writes: PlanWrite[]) {
  let created = 0;
  let existed = 0;
  const failed: string[] = [];
  const bulk = db.bulkWriter();
  bulk.onWriteError((err) => {
    if (err.code === 6 /* ALREADY_EXISTS */) existed++;
    else failed.push(`${err.documentRef.path}: ${err.message}`);
    return false;
  });
  for (const w of writes) {
    bulk
      .create(db.doc(w.path), decode(db, w.data) as FirebaseFirestore.DocumentData)
      .then(() => created++)
      .catch(() => {});
  }
  await bulk.close();
  return { created, existed, failed };
}
