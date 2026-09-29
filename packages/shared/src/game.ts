/*
 * Живая игра без сервера: логика ведущего (бывший LiveManager ІнфоКласа) в виде
 * чистых функций. Ведущий — браузер учителя: он хранит состояние игры в
 * Firestore (games/{id}) и после перезагрузки вкладки пересчитывает всё из
 * ответов учеников (games/{id}/answers), поэтому игра продолжается с того же места.
 */
import {
  describeCorrectAnswer,
  isAnswerCorrect,
  type AnswerMap,
  type AnswerValue,
  type Question,
} from './grading.js';

export type GameStatus = 'lobby' | 'question' | 'reveal' | 'finished';

/** Late answers within this window are still accepted (network latency); rules use the same. */
export const ANSWER_GRACE_MS = 1500;
export const LEADERBOARD_SIZE = 5;

/** One answer document: `at` is the server time of the write (request.time). */
export interface GameAnswer {
  studentId: string;
  index: number;
  value: AnswerValue;
  /** Milliseconds (server time). */
  at: number;
}

export interface Scored {
  correct: boolean;
  points: number;
  value: AnswerValue;
}

export interface PlayerTally {
  studentId: string;
  score: number;
  correctCount: number;
  /** By question index. */
  answers: Map<number, Scored>;
}

/**
 * Points for a correct answer. Grades 2–4: no speed pressure, always 100.
 * Grades 5–9: 500 + up to 500 for speed (as the old server did).
 */
export function questionPoints(
  junior: boolean,
  q: Question,
  startedAt: number | undefined,
  at: number,
): number {
  if (junior || startedAt === undefined) return 100;
  const limit = q.timeLimitSec * 1000;
  const remaining = Math.max(0, Math.min(1, 1 - (at - startedAt) / limit));
  return 500 + Math.round(500 * remaining);
}

/**
 * Scores of every joined player over the questions asked so far. The first
 * answer to a question counts; answers to questions not asked yet are ignored.
 */
export function tally(input: {
  questions: Question[];
  answers: GameAnswer[];
  players: string[];
  /** Questions asked: index + 1 of the last opened question (0 in the lobby). */
  asked: number;
  /** Question start (server ms) by index. */
  starts: Record<string, number>;
  junior: boolean;
}): Map<string, PlayerTally> {
  const out = new Map<string, PlayerTally>();
  const get = (id: string) => {
    let t = out.get(id);
    if (!t) {
      t = { studentId: id, score: 0, correctCount: 0, answers: new Map() };
      out.set(id, t);
    }
    return t;
  };
  for (const id of input.players) get(id);
  const sorted = [...input.answers].sort((a, b) => a.at - b.at);
  for (const a of sorted) {
    const q = input.questions[a.index];
    if (!q || a.index >= input.asked) continue;
    const t = get(a.studentId);
    if (t.answers.has(a.index)) continue;
    const correct = isAnswerCorrect(q, a.value);
    const points = correct
      ? questionPoints(input.junior, q, input.starts[String(a.index)], a.at)
      : 0;
    t.answers.set(a.index, { correct, points, value: a.value });
    t.score += points;
    if (correct) t.correctCount++;
  }
  return out;
}

/** Everyone who joined has answered the current question → reveal right away. */
export function everyoneAnswered(players: string[], answers: GameAnswer[], index: number): boolean {
  if (!players.length) return false;
  const done = new Set(answers.filter((a) => a.index === index).map((a) => a.studentId));
  return players.every((p) => done.has(p));
}

/** How many chose each option (choice questions) at reveal. */
export function optionStats(
  q: Question,
  answers: GameAnswer[],
  index: number,
): Record<string, number> {
  if (q.type === 'text') return {};
  const first = firstAnswers(answers, index);
  const stats: Record<string, number> = {};
  for (const o of q.options) {
    stats[o.id] = first.filter((a) =>
      Array.isArray(a.value) ? a.value.includes(o.id) : a.value === o.id,
    ).length;
  }
  return stats;
}

/** Word answers shown on the projector at reveal. */
export function textAnswers(
  q: Question,
  answers: GameAnswer[],
  index: number,
  names: Map<string, string>,
) {
  if (q.type !== 'text') return [];
  return firstAnswers(answers, index)
    .filter((a) => typeof a.value === 'string')
    .map((a) => ({
      name: names.get(a.studentId) ?? '—',
      value: String(a.value),
      correct: isAnswerCorrect(q, a.value),
    }));
}

function firstAnswers(answers: GameAnswer[], index: number): GameAnswer[] {
  const seen = new Set<string>();
  return [...answers]
    .filter((a) => a.index === index)
    .sort((a, b) => a.at - b.at)
    .filter((a) => (seen.has(a.studentId) ? false : (seen.add(a.studentId), true)));
}

export function leaderboard(
  t: Map<string, PlayerTally>,
  names: Map<string, string>,
  size = LEADERBOARD_SIZE,
) {
  return [...t.values()]
    .map((p) => ({ studentId: p.studentId, name: names.get(p.studentId) ?? '—', score: p.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'uk'))
    .slice(0, size);
}

/** What the game document says at reveal (pupils read it; they can't read the key). */
export function revealInfo(q: Question) {
  return {
    correctIds:
      q.type === 'single' ? [q.correctOptionId] : q.type === 'multiple' ? q.correctOptionIds : [],
    correctText: describeCorrectAnswer(q),
  };
}

/** After «Наступне»: the next question or the end. */
export function nextStep(
  index: number,
  count: number,
): { status: 'question'; index: number } | { status: 'finished' } {
  return index + 1 < count ? { status: 'question', index: index + 1 } : { status: 'finished' };
}

/**
 * Journal rows at the end: only questions actually asked count (the teacher may
 * end early); a game ended in the lobby gives no rows.
 */
export function gameResults(t: Map<string, PlayerTally>, questions: Question[], asked: number) {
  if (asked <= 0) return [];
  return [...t.values()].map((p) => {
    const answers: AnswerMap = {};
    for (const [i, a] of p.answers) answers[questions[i]!.id] = a.value;
    return {
      studentId: p.studentId,
      score: p.score,
      correctCount: p.correctCount,
      total: asked,
      answers,
    };
  });
}
