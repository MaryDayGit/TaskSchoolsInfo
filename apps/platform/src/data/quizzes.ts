import {
  collection,
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Timestamp,
} from 'firebase/firestore';
import type { ImportedTest, Question } from '@infoklas/shared';
import { db } from '../firebase/app';

// Банк тестов (docs/platform/DATA_MODEL.md, «Банк тестов»): только учитель.

export interface QuizDoc {
  title: string;
  folder: string;
  /** With answers: students never read the bank. */
  questions: Question[];
  createdAt: Timestamp | null;
  updatedAt: Timestamp | null;
}

export const TITLE_MAX = 200;
export const FOLDER_MAX = 60;
export const NO_FOLDER = 'Без папки';

export const quizzesCol = () => collection(db, 'quizzes');
export const quizRef = (id: string) => doc(db, 'quizzes', id);

export interface QuizInput {
  title: string;
  folder: string;
  questions: Question[];
}

export async function createQuiz(input: QuizInput): Promise<string> {
  const ref = doc(quizzesCol());
  await setDoc(ref, { ...input, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  return ref.id;
}

export async function saveQuiz(id: string, input: QuizInput) {
  await updateDoc(quizRef(id), { ...input, updatedAt: serverTimestamp() });
}

/** Given assignments keep their own snapshot, so deleting a quiz doesn't touch them. */
export async function deleteQuiz(id: string) {
  await deleteDoc(quizRef(id));
}

export async function importQuizzes(tests: ImportedTest[], defaultFolder: string) {
  for (let i = 0; i < tests.length; i += 400) {
    const batch = writeBatch(db);
    for (const t of tests.slice(i, i + 400)) {
      batch.set(doc(quizzesCol()), {
        title: t.title,
        folder: t.folder || defaultFolder,
        questions: t.questions,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();
  }
}
