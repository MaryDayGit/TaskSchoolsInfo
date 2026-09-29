import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
  type Timestamp,
  type WriteBatch,
} from 'firebase/firestore';
import { db } from '../firebase/app';
import { isPermissionDenied } from '../firebase/errors';
import { generateJoinCode, generateSecret, type SecretKind } from '../lib/secrets';

// Документы Firestore (docs/platform/DATA_MODEL.md, «Классы и ученики»).

export interface ClassDoc {
  name: string;
  grade: number;
  joinCode: string;
  createdAt: Timestamp | null;
  archived: boolean;
}

export interface RosterDoc {
  displayName: string;
  secretKind: SecretKind;
  /** Only for pictures: 4 in the platform, 3 for passwords migrated from ІнфоКлас. */
  pictureCount?: number;
  createdAt: Timestamp | null;
}

export interface SecretDoc {
  classId: string;
  secret: string;
}

export interface BindingDoc {
  classId: string;
  studentId: string;
  secret: string;
  createdAt: Timestamp | null;
  device: string;
}

export const MAX_STUDENTS = 60;
export const NAME_MAX = 60;
export const CLASS_NAME_MAX = 40;

export const classRef = (id: string) => doc(db, 'classes', id);
export const rosterCol = (classId: string) => collection(db, 'classes', classId, 'roster');
export const rosterRef = (classId: string, studentId: string) =>
  doc(db, 'classes', classId, 'roster', studentId);
export const secretRef = (studentId: string) => doc(db, 'studentSecrets', studentId);
export const joinCodeRef = (code: string) => doc(db, 'joinCodes', code);
export const bindingRef = (uid: string) => doc(db, 'bindings', uid);

const newId = () => doc(collection(db, 'classes')).id;

/**
 * Retries with a new random code if the code is taken: creating an existing
 * joinCodes document is an update, which the rules reject.
 */
async function withFreshCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(generateJoinCode());
    } catch (err) {
      if (!isPermissionDenied(err) || attempt >= 5) throw err;
    }
  }
}

export async function createClass(name: string, grade: number): Promise<string> {
  const id = newId();
  await withFreshCode(async (joinCode) => {
    const batch = writeBatch(db);
    batch.set(classRef(id), { name, grade, joinCode, createdAt: serverTimestamp(), archived: false });
    batch.set(joinCodeRef(joinCode), { classId: id });
    await batch.commit();
  });
  return id;
}

/**
 * Changing between primary (2–4) and middle school (5–9) doesn't change existing
 * passwords: the teacher issues new ones with «Новий пароль».
 */
export async function updateClass(id: string, name: string, grade: number) {
  const batch = writeBatch(db);
  batch.update(classRef(id), { name, grade });
  await batch.commit();
}

export async function regenerateJoinCode(id: string, oldCode: string) {
  await withFreshCode(async (joinCode) => {
    const batch = writeBatch(db);
    batch.update(classRef(id), { joinCode });
    batch.set(joinCodeRef(joinCode), { classId: id });
    batch.delete(joinCodeRef(oldCode));
    await batch.commit();
  });
}

/** Firestore batches hold at most 500 writes. */
async function commitInChunks(ops: ((b: WriteBatch) => void)[]) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db);
    ops.slice(i, i + 450).forEach((op) => op(batch));
    await batch.commit();
  }
}

export async function bindingsOfClass(classId: string) {
  return getDocs(query(collection(db, 'bindings'), where('classId', '==', classId)));
}

/** Deletes the class with its students, passwords, devices and join code. */
export async function deleteClass(id: string, joinCode: string) {
  const [roster, bindings] = await Promise.all([getDocs(rosterCol(id)), bindingsOfClass(id)]);
  const ops: ((b: WriteBatch) => void)[] = [];
  bindings.forEach((d) => ops.push((b) => b.delete(d.ref)));
  roster.forEach((d) => {
    ops.push((b) => b.delete(secretRef(d.id)));
    ops.push((b) => b.delete(d.ref));
  });
  await commitInChunks(ops);
  const batch = writeBatch(db);
  batch.delete(joinCodeRef(joinCode));
  batch.delete(classRef(id));
  await batch.commit();
}

/** Adds students with generated passwords. Duplicate names are rejected before writing. */
export async function addStudents(classId: string, grade: number, names: string[]) {
  const ops: ((b: WriteBatch) => void)[] = [];
  for (const displayName of names) {
    const id = newId();
    const { kind, secret, pictureCount } = generateSecret(grade);
    ops.push((b) =>
      b.set(rosterRef(classId, id), {
        displayName,
        secretKind: kind,
        ...(pictureCount ? { pictureCount } : {}),
        createdAt: serverTimestamp(),
      }),
    );
    ops.push((b) => b.set(secretRef(id), { classId, secret }));
  }
  await commitInChunks(ops);
}

export async function renameStudent(classId: string, studentId: string, displayName: string) {
  const batch = writeBatch(db);
  batch.update(rosterRef(classId, studentId), { displayName });
  await batch.commit();
}

/**
 * New password (e.g. a lost card, or after the class moved from grade 4 to 5).
 * Old devices stop working at once: the rules compare bindings with the current password.
 */
export async function resetSecret(classId: string, studentId: string, grade: number) {
  const { kind, secret, pictureCount } = generateSecret(grade);
  const batch = writeBatch(db);
  batch.set(rosterRef(classId, studentId), { secretKind: kind, pictureCount: pictureCount ?? null }, { merge: true });
  batch.set(secretRef(studentId), { classId, secret });
  await batch.commit();
  await logoutAllDevices(studentId);
}

export async function logoutAllDevices(studentId: string) {
  const snap = await getDocs(query(collection(db, 'bindings'), where('studentId', '==', studentId)));
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}

export async function deleteStudent(classId: string, studentId: string) {
  await logoutAllDevices(studentId);
  const batch = writeBatch(db);
  batch.delete(secretRef(studentId));
  batch.delete(rosterRef(classId, studentId));
  await batch.commit();
}
