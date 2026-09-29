import {
  Timestamp,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  toPublicQuestion,
  type AnswerMap,
  type PublicQuestion,
  type Question,
} from '@infoklas/shared/grading';
import { db } from '../firebase/app';

// Документы Firestore (docs/platform/DATA_MODEL.md, «Задания»). Этот модуль
// нужен и ученику, поэтому он не тянет zod (только `@infoklas/shared/grading`).

export type Reveal = 'immediate' | 'after_due' | 'never';

export interface AssignmentSummary {
  submitted: number;
  avgPercent: number;
  updatedAt: Timestamp | null;
}

export interface AssignmentDoc {
  classId: string;
  kind: 'homework' | 'lesson';
  quizId: string;
  title: string;
  /** Snapshot WITHOUT answers: students read it. */
  questions: PublicQuestion[];
  dueAt: Timestamp | null;
  maxAttempts: number | null;
  reveal: Reveal;
  revealNow: boolean;
  roomId: string | null;
  createdAt: Timestamp | null;
  summary?: AssignmentSummary;
}

export interface KeyDoc {
  /** Snapshot WITH answers. */
  questions: Question[];
}

export interface SubmissionDoc {
  assignmentId: string;
  classId: string;
  studentId: string;
  attempt: number;
  answers: AnswerMap;
  submittedAt: Timestamp | null;
}

export const REVEAL_LABELS: Record<Reveal, string> = {
  immediate: 'Одразу після здачі',
  after_due: 'Після терміну',
  never: 'Не показувати',
};

export const assignmentsCol = () => collection(db, 'assignments');
export const assignmentRef = (id: string) => doc(db, 'assignments', id);
export const keyRef = (id: string) => doc(db, 'assignmentKeys', id);
export const submissionsCol = () => collection(db, 'submissions');
export const submissionRef = (assignmentId: string, studentId: string, attempt: number) =>
  doc(db, 'submissions', `${assignmentId}_${studentId}_${attempt}`);

/** Assignments of a class. Students may only query with the class filter (rules). */
export const classAssignmentsQuery = (classId: string) =>
  query(assignmentsCol(), where('classId', '==', classId));

/** A student's own submissions: the class filter lets the rules check the query. */
export const mySubmissionsQuery = (classId: string, assignmentId: string, studentId: string) =>
  query(
    submissionsCol(),
    where('classId', '==', classId),
    where('assignmentId', '==', assignmentId),
    where('studentId', '==', studentId),
  );

/** All of a student's submissions in their class (for the homework list). */
export const myClassSubmissionsQuery = (classId: string, studentId: string) =>
  query(submissionsCol(), where('classId', '==', classId), where('studentId', '==', studentId));

export function isClosed(a: Pick<AssignmentDoc, 'dueAt'>, now = Date.now()): boolean {
  return !!a.dueAt && a.dueAt.toMillis() < now;
}

export async function createAssignment(input: {
  classId: string;
  quizId: string;
  title: string;
  questions: Question[];
  dueAt: Date | null;
  maxAttempts: number | null;
  reveal: Reveal;
}): Promise<string> {
  const ref = doc(assignmentsCol());
  const batch = writeBatch(db);
  batch.set(ref, {
    classId: input.classId,
    kind: 'homework',
    quizId: input.quizId,
    title: input.title,
    questions: input.questions.map(toPublicQuestion),
    dueAt: input.dueAt ? Timestamp.fromDate(input.dueAt) : null,
    maxAttempts: input.maxAttempts,
    reveal: input.reveal,
    revealNow: false,
    roomId: null,
    createdAt: serverTimestamp(),
  });
  batch.set(keyRef(ref.id), { questions: input.questions });
  await batch.commit();
  return ref.id;
}

export async function updateAssignment(
  id: string,
  patch: { dueAt?: Date | null; maxAttempts?: number | null; reveal?: Reveal },
) {
  const data: Record<string, unknown> = {};
  if (patch.dueAt !== undefined) data.dueAt = patch.dueAt ? Timestamp.fromDate(patch.dueAt) : null;
  if (patch.maxAttempts !== undefined) data.maxAttempts = patch.maxAttempts;
  if (patch.reveal !== undefined) data.reveal = patch.reveal;
  await updateDoc(assignmentRef(id), data);
}

export async function saveSummary(id: string, submitted: number, avgPercent: number) {
  await updateDoc(assignmentRef(id), {
    summary: { submitted, avgPercent, updatedAt: serverTimestamp() },
  });
}

export async function loadSubmissions(assignmentId: string) {
  const snap = await getDocs(query(submissionsCol(), where('assignmentId', '==', assignmentId)));
  return snap.docs.map((d) => d.data() as SubmissionDoc);
}

/** Deletes an assignment with its key and all submissions. */
export async function deleteAssignment(id: string) {
  const [subs, guests] = await Promise.all([
    getDocs(query(submissionsCol(), where('assignmentId', '==', id))),
    getDocs(query(collection(db, 'guestResults'), where('assignmentId', '==', id))),
  ]);
  const refs = [
    ...subs.docs.map((d) => d.ref),
    ...guests.docs.map((d) => d.ref),
    keyRef(id),
    assignmentRef(id),
  ];
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Everything given to a class: used when the class is deleted. */
export async function deleteClassWork(classId: string) {
  const [assignments, subs] = await Promise.all([
    getDocs(query(assignmentsCol(), where('classId', '==', classId))),
    getDocs(query(submissionsCol(), where('classId', '==', classId))),
  ]);
  // Guest answers of lesson tests (guests are not in the class list).
  const guests = await Promise.all(
    assignments.docs
      .filter((d) => d.get('kind') === 'lesson')
      .map((d) =>
        getDocs(query(collection(db, 'guestResults'), where('assignmentId', '==', d.id))),
      ),
  );
  const refs = [
    ...subs.docs.map((d) => d.ref),
    ...guests.flatMap((g) => g.docs.map((d) => d.ref)),
    ...assignments.docs.flatMap((d) => [keyRef(d.id), d.ref]),
  ];
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** A student's submission: raw answers only, the score is computed by whoever reads it. */
export async function submitAnswers(input: {
  assignmentId: string;
  classId: string;
  studentId: string;
  attempt: number;
  answers: AnswerMap;
}) {
  await setDoc(submissionRef(input.assignmentId, input.studentId, input.attempt), {
    ...input,
    submittedAt: serverTimestamp(),
  });
}
