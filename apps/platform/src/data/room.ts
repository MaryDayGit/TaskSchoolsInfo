import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import { toPublicQuestion, type Question } from '@infoklas/shared/grading';
import type { LessonTask } from '@infoklas/shared/lesson';
import { db } from '../firebase/app';
import { assignmentRef, keyRef, submissionsCol } from './assignments';

// Пульт урока (docs/platform/DATA_MODEL.md, «Пульт урока»): бывший control/state
// Клас-пульта — rooms/{roomId}, карточки ПК — rooms/{roomId}/pcs/{pcId}.

/** One computer lab for now; a second one would be another room id. */
export const ROOM_ID = 'lab';

export type Theme = 'junior' | 'senior';

export interface TimerDoc {
  id: number;
  durationMs: number;
  startedAt: Timestamp | null;
}

export interface LastTest {
  assignmentId: string;
  title: string;
  sentAt: number;
  target: string[] | null;
}

export interface RoomDoc {
  classId?: string | null;
  className?: string;
  task?: LessonTask | null;
  lastTest?: LastTest | null;
  locked?: boolean;
  theme?: Theme;
  timer?: TimerDoc | null;
  /** pcId → handId the teacher lowered. */
  handsDown?: Record<string, number>;
  /** Teacher's Date.now() at «Новий клас»: school PCs log out when it changes. */
  resetAt?: number;
}

export interface PcDoc {
  pc: string;
  num: number;
  name: string;
  studentId: string | null;
  lastSeen: Timestamp | null;
  openedAt?: number | null;
  submittedAt?: number | null;
  doneAt?: number | null;
  handAt?: Timestamp | null;
  handId?: number | null;
}

export interface GuestResultDoc {
  assignmentId: string;
  pcId: string;
  name: string;
  answers: Record<string, string | string[]>;
  submittedAt: Timestamp | null;
}

export const roomRef = (roomId = ROOM_ID) => doc(db, 'rooms', roomId);
export const pcsCol = (roomId = ROOM_ID) => collection(db, 'rooms', roomId, 'pcs');
export const pcRef = (pcId: string, roomId = ROOM_ID) => doc(db, 'rooms', roomId, 'pcs', pcId);
export const guestResultsCol = () => collection(db, 'guestResults');

/** Grades 7–9 get the «Старші» look by default (Клас-пульт: junior 2–6, senior 7–9). */
export const defaultTheme = (grade: number): Theme => (grade >= 7 ? 'senior' : 'junior');

// ---------------------------------------------------------------------------
// Teacher

/**
 * «Новий клас»: the lesson class changes, PCs of the previous class log out
 * (they compare resetAt), cards are deleted, the task and timer are cleared.
 */
export async function startLesson(
  cls: { id: string; name: string; grade: number },
  prev: RoomDoc | null,
) {
  const batch = writeBatch(db);
  batch.set(
    roomRef(),
    {
      classId: cls.id,
      className: cls.name,
      resetAt: Date.now(),
      task: null,
      timer: null,
      lastTest: null,
      locked: false,
      theme: defaultTheme(cls.grade),
      handsDown: deleteField(),
    },
    { merge: true },
  );
  dropReveal(batch, prev?.lastTest?.assignmentId ?? null, null);
  await batch.commit();
  const cards = await getDocs(pcsCol());
  for (let i = 0; i < cards.docs.length; i += 400) {
    const b = writeBatch(db);
    cards.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
}

/** «Завершити урок»: no class on the lab; school PCs log out (resetAt changes). */
export async function endLesson(prev: RoomDoc | null) {
  const batch = writeBatch(db);
  batch.set(
    roomRef(),
    {
      classId: null,
      className: '',
      resetAt: Date.now(),
      task: null,
      timer: null,
      locked: false,
      handsDown: deleteField(),
    },
    { merge: true },
  );
  dropReveal(batch, prev?.lastTest?.assignmentId ?? null, null);
  await batch.commit();
  const cards = await getDocs(pcsCol());
  for (let i = 0; i < cards.docs.length; i += 400) {
    const b = writeBatch(db);
    cards.docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
}

/**
 * Closes the review of the previous lesson test (its key would otherwise stay
 * readable for everyone: the same test may later be given to another class).
 */
function dropReveal(
  batch: ReturnType<typeof writeBatch>,
  oldId: string | null,
  keepId: string | null,
) {
  if (oldId && oldId !== keepId) batch.update(assignmentRef(oldId), { revealNow: false });
}

/**
 * Sends a task. `mergeFields`, not `merge`: otherwise fields of the old task
 * (a link's url) would stay inside the new one (Клас-пульт lesson).
 */
export async function sendTask(task: LessonTask, room: RoomDoc, opts: { reveal?: boolean } = {}) {
  const batch = writeBatch(db);
  const data: Record<string, unknown> = { task };
  const fields = ['task'];
  if (task.type === 'test' && task.assignmentId) {
    data.lastTest = {
      assignmentId: task.assignmentId,
      title: task.title ?? '',
      sentAt: task.sentAt,
      target: task.target,
    } satisfies LastTest;
    fields.push('lastTest');
    batch.update(assignmentRef(task.assignmentId), { revealNow: !!opts.reveal });
  }
  dropReveal(batch, room.lastTest?.assignmentId ?? null, task.assignmentId ?? null);
  batch.set(roomRef(), data, { mergeFields: fields });
  await batch.commit();
}

export async function clearScreens(room: RoomDoc) {
  const batch = writeBatch(db);
  batch.set(roomRef(), { task: null }, { mergeFields: ['task'] });
  dropReveal(batch, room.lastTest?.assignmentId ?? null, null);
  await batch.commit();
}

export const setLocked = (locked: boolean) => setDoc(roomRef(), { locked }, { merge: true });
export const setTheme = (theme: Theme) => setDoc(roomRef(), { theme }, { merge: true });
export const lowerHands = (down: Record<string, number>) =>
  setDoc(roomRef(), { handsDown: down }, { merge: true });

export const startTimer = (minutes: number) =>
  setDoc(
    roomRef(),
    { timer: { id: Date.now(), durationMs: minutes * 60_000, startedAt: serverTimestamp() } },
    { mergeFields: ['timer'] },
  );
export const setTimer = (timer: TimerDoc | null) =>
  setDoc(roomRef(), { timer }, { mergeFields: ['timer'] });

export const setReveal = (assignmentId: string, on: boolean) =>
  updateDoc(assignmentRef(assignmentId), { revealNow: on });

/**
 * The lesson test is an assignment of kind "lesson" (it goes to the journal).
 * One per test and lesson class period (resetAt), like a Клас-пульт session:
 * sending the same test again to latecomers reuses it.
 */
export async function ensureLessonAssignment(
  room: RoomDoc,
  quiz: { id: string; title: string; questions: Question[] },
): Promise<string> {
  if (!room.classId || !room.resetAt) throw new Error('Спочатку оберіть клас уроку.');
  const id = `lesson_${room.resetAt}_${quiz.id}`;
  const snap = await getDoc(assignmentRef(id));
  if (snap.exists()) return id;
  const batch = writeBatch(db);
  batch.set(assignmentRef(id), {
    classId: room.classId,
    kind: 'lesson',
    quizId: quiz.id,
    title: quiz.title,
    questions: quiz.questions.map(toPublicQuestion),
    dueAt: null,
    maxAttempts: 1,
    reveal: 'never',
    revealNow: false,
    roomId: ROOM_ID,
    createdAt: serverTimestamp(),
  });
  batch.set(keyRef(id), { questions: quiz.questions });
  await batch.commit();
  return id;
}

export const lessonSubmissionsQuery = (assignmentId: string) =>
  query(submissionsCol(), where('assignmentId', '==', assignmentId));
export const guestResultsQuery = (assignmentId: string) =>
  query(guestResultsCol(), where('assignmentId', '==', assignmentId));

// ---------------------------------------------------------------------------
// Pupil's PC

/** Card fields a PC writes; merge keeps the teacher's view of the rest. */
export function writePc(
  pcId: string,
  data: Partial<Omit<PcDoc, 'lastSeen' | 'handAt'>> & Record<string, unknown>,
) {
  return setDoc(pcRef(pcId), { ...data, lastSeen: serverTimestamp() }, { merge: true });
}

export async function submitGuestLesson(input: {
  assignmentId: string;
  pcId: string;
  name: string;
  answers: Record<string, string | string[]>;
  card: Record<string, unknown>;
}) {
  const batch = writeBatch(db);
  batch.set(doc(guestResultsCol()), {
    assignmentId: input.assignmentId,
    pcId: input.pcId,
    name: input.name,
    answers: input.answers,
    submittedAt: serverTimestamp(),
  });
  batch.set(pcRef(input.pcId), { ...input.card, lastSeen: serverTimestamp() }, { merge: true });
  await batch.commit();
}

export async function submitStudentLesson(input: {
  assignmentId: string;
  classId: string;
  studentId: string;
  pcId: string;
  answers: Record<string, string | string[]>;
  card: Record<string, unknown>;
}) {
  // Answers and «здав(ла)» on the card in one batch (as in Клас-пульт).
  const batch = writeBatch(db);
  batch.set(doc(db, 'submissions', `${input.assignmentId}_${input.studentId}_1`), {
    assignmentId: input.assignmentId,
    classId: input.classId,
    studentId: input.studentId,
    attempt: 1,
    answers: input.answers,
    pcId: input.pcId,
    submittedAt: serverTimestamp(),
  });
  batch.set(pcRef(input.pcId), { ...input.card, lastSeen: serverTimestamp() }, { merge: true });
  await batch.commit();
}
