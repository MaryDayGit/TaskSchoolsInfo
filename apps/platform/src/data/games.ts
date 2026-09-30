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
  type AnswerValue,
  type PublicQuestion,
  type Question,
} from '@infoklas/shared/grading';
import { db } from '../firebase/app';
import { isPermissionDenied } from '../firebase/errors';

// Живая игра (docs/platform/DATA_MODEL.md, «Живые игры»). Модуль нужен и
// ученику, поэтому только `@infoklas/shared/grading` (без zod).

export type GameStatus = 'lobby' | 'question' | 'reveal' | 'finished';

export interface GamePlayerInfo {
  name: string;
  score: number;
  correct: number;
  /** Result of the last revealed question. */
  last: { correct: boolean; points: number } | null;
}

export interface GameDoc {
  classId: string;
  className: string;
  quizId: string;
  title: string;
  /** Without answers: pupils read the game. */
  questions: PublicQuestion[];
  status: GameStatus;
  /** Current question; -1 in the lobby. */
  index: number;
  deadline: Timestamp | null;
  /** Question start (server ms) by index — for the speed bonus. */
  starts: Record<string, number>;
  junior: boolean;
  stats?: { options: Record<string, number>; answered: number } | null;
  reveal?: { correctIds: string[]; correctText: string } | null;
  players?: Record<string, GamePlayerInfo>;
  leaderboard?: { name: string; score: number }[];
  createdAt: Timestamp | null;
  finishedAt?: Timestamp | null;
  /** true until the game is finished: pupils look for active games of their class. */
  active: boolean;
  /** Game code on the projector (gamePins/{pin}); removed when the game ends. */
  pin?: string;
}

export interface GamePinDoc {
  gameId: string;
  classId: string;
}

export interface GameAnswerDoc {
  studentId: string;
  index: number;
  value: AnswerValue;
  at: Timestamp | null;
}

export const gamesCol = () => collection(db, 'games');
export const gameRef = (id: string) => doc(db, 'games', id);
export const gameKeyRef = (id: string) => doc(db, 'gameKeys', id);
export const gamePlayersCol = (id: string) => collection(db, 'games', id, 'players');
export const gamePlayerRef = (id: string, studentId: string) =>
  doc(db, 'games', id, 'players', studentId);
export const gameAnswersCol = (id: string) => collection(db, 'games', id, 'answers');
export const gameAnswerRef = (id: string, studentId: string, index: number) =>
  doc(db, 'games', id, 'answers', `${studentId}_${index}`);
export const gameResultsCol = () => collection(db, 'gameResults');
export const gamePinRef = (pin: string) => doc(db, 'gamePins', pin);

const randomPin = () => {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100_000 + (buf[0]! % 900_000));
};

/** Games of a class (pupils may only query with the class filter). */
export const classGamesQuery = (classId: string) =>
  query(gamesCol(), where('classId', '==', classId));

/** The running games of a class: two equality filters, no composite index needed. */
export const activeGamesQuery = (classId: string) =>
  query(gamesCol(), where('classId', '==', classId), where('active', '==', true));

// ---------------------------------------------------------------------------
// Host (teacher)

export async function createGame(
  cls: { id: string; name: string; junior: boolean },
  quiz: { id: string; title: string; questions: Question[] },
): Promise<string> {
  const ref = doc(gamesCol());
  // A code that is taken is an update of gamePins/{pin}, which the rules refuse:
  // then another code is tried.
  for (let attempt = 0; ; attempt++) {
    const pin = randomPin();
    const batch = writeBatch(db);
    batch.set(ref, {
      classId: cls.id,
      className: cls.name,
      quizId: quiz.id,
      title: quiz.title,
      questions: quiz.questions.map(toPublicQuestion),
      status: 'lobby',
      index: -1,
      deadline: null,
      starts: {},
      junior: cls.junior,
      players: {},
      active: true,
      pin,
      createdAt: serverTimestamp(),
    });
    batch.set(gameKeyRef(ref.id), { questions: quiz.questions });
    batch.set(gamePinRef(pin), { gameId: ref.id, classId: cls.id, createdAt: serverTimestamp() });
    try {
      await batch.commit();
      return ref.id;
    } catch (err) {
      if (!isPermissionDenied(err) || attempt >= 4) throw err;
    }
  }
}

/** Opens a question: the deadline is in server time (the host's clock is synced). */
export function openQuestion(
  id: string,
  index: number,
  startMs: number,
  limitSec: number,
  starts: Record<string, number>,
) {
  return updateDoc(gameRef(id), {
    status: 'question',
    index,
    deadline: Timestamp.fromMillis(startMs + limitSec * 1000),
    starts: { ...starts, [String(index)]: startMs },
    stats: null,
    reveal: null,
  });
}

export function revealQuestion(
  id: string,
  data: Pick<GameDoc, 'stats' | 'reveal' | 'players' | 'leaderboard'>,
) {
  return updateDoc(gameRef(id), { status: 'reveal', deadline: null, ...data });
}

/** Ends the game and writes the journal rows (none if it ended in the lobby). */
export async function finishGame(
  id: string,
  pin: string | undefined,
  classId: string,
  data: Pick<GameDoc, 'players' | 'leaderboard'>,
  rows: {
    studentId: string;
    score: number;
    correctCount: number;
    total: number;
    answers: Record<string, AnswerValue>;
  }[],
) {
  const batch = writeBatch(db);
  if (pin) batch.delete(gamePinRef(pin));
  batch.update(gameRef(id), {
    status: 'finished',
    active: false,
    deadline: null,
    finishedAt: serverTimestamp(),
    ...data,
  });
  for (const r of rows) {
    batch.set(doc(gameResultsCol(), `${id}_${r.studentId}`), {
      gameId: id,
      classId,
      ...r,
      finishedAt: serverTimestamp(),
    });
  }
  await batch.commit();
}

/** A game with its players, answers, key and results (class deletion). */
export async function deleteGame(id: string, pin?: string) {
  const [players, answers, results] = await Promise.all([
    getDocs(gamePlayersCol(id)),
    getDocs(gameAnswersCol(id)),
    getDocs(query(gameResultsCol(), where('gameId', '==', id))),
  ]);
  const refs = [
    ...players.docs.map((d) => d.ref),
    ...answers.docs.map((d) => d.ref),
    ...results.docs.map((d) => d.ref),
    gameKeyRef(id),
    gameRef(id),
    ...(pin ? [gamePinRef(pin)] : []),
  ];
  for (let i = 0; i < refs.length; i += 450) {
    const batch = writeBatch(db);
    refs.slice(i, i + 450).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

// ---------------------------------------------------------------------------
// Pupil

export const joinGame = (id: string, studentId: string) =>
  setDoc(gamePlayerRef(id, studentId), { joinedAt: serverTimestamp() });

export const answerGame = (id: string, studentId: string, index: number, value: AnswerValue) =>
  setDoc(gameAnswerRef(id, studentId, index), { studentId, index, value, at: serverTimestamp() });

/** Every game of a class (class deletion). */
export async function deleteClassGames(classId: string) {
  const games = await getDocs(classGamesQuery(classId));
  for (const g of games.docs) await deleteGame(g.id, g.get('pin') as string | undefined);
}
