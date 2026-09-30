/*
 * Перенос из прежнего ІнфоКласа (PostgreSQL на Neon), docs/platform/MIGRATION.md §2.
 * Идентификаторы (UUID) сохраняются, поэтому ссылки остаются согласованными.
 *
 *   classes        → classes/{id} + joinCodes/{code}
 *   students       → classes/{classId}/roster/{id} + studentSecrets/{id} (пароли продолжают работать)
 *   quizzes        → quizzes/{id}
 *   assignments    → assignments/{id} (homework) + assignmentKeys/{id}
 *   submissions    → submissions/{assignmentId}_{studentId}_{attempt}
 *   live_sessions (finished) + live_results → games/{id} + gameKeys/{id} + gameResults/{id}_{studentId}
 *   teachers       — не переносятся: вход по коду учителя.
 */
import {
  assignmentResults,
  leaderboard,
  summarize,
  type AnswerMap,
  type PlayerTally,
  type Question,
} from '@infoklas/shared';
import { freshJoinCode, ms, publicQuestions, ts, type Plan, type PlanWrite } from './plan';

/** Rows as `SELECT *` returns them (snake_case columns). */
export interface InfoKlasRows {
  classes: {
    id: string;
    name: string;
    grade: number;
    join_code: string;
    created_at: unknown;
  }[];
  students: {
    id: string;
    class_id: string;
    display_name: string;
    secret_kind: string;
    secret: string;
    created_at: unknown;
  }[];
  quizzes: {
    id: string;
    title: string;
    questions: Question[];
    created_at: unknown;
    updated_at: unknown;
  }[];
  assignments: {
    id: string;
    class_id: string;
    quiz_id: string | null;
    title: string;
    questions: Question[];
    due_at: unknown;
    max_attempts: number | null;
    show_correct: boolean;
    created_at: unknown;
  }[];
  submissions: {
    id: string;
    assignment_id: string;
    student_id: string;
    attempt: number;
    answers: AnswerMap;
    submitted_at: unknown;
  }[];
  live_sessions: {
    id: string;
    class_id: string;
    quiz_id: string | null;
    title: string;
    questions: Question[];
    status: string;
    created_at: unknown;
    ended_at: unknown;
  }[];
  live_results: {
    session_id: string;
    student_id: string;
    score: number;
    correct_count: number;
    total: number;
    answers: AnswerMap;
  }[];
}

export const INFOKLAS_TABLES = [
  'classes',
  'students',
  'quizzes',
  'assignments',
  'submissions',
  'live_sessions',
  'live_results',
] as const;

/** `SELECT *` of every table through any client: pg (Neon) or PGlite in tests. */
export async function readInfoKlasRows(
  query: (sql: string) => Promise<{ rows: unknown[] }>,
): Promise<InfoKlasRows> {
  const out: Record<string, unknown[]> = {};
  for (const t of INFOKLAS_TABLES) out[t] = (await query(`SELECT * FROM ${t}`)).rows;
  return out as unknown as InfoKlasRows;
}

const clip = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** The same normalization as the old server and the new login (word: lower case). */
const secretFor = (kind: string, secret: string) =>
  kind === 'password' ? secret.trim().toLowerCase() : secret.trim();

export function planInfoKlas(
  rows: InfoKlasRows,
  target: { path: string }[],
  opts: { now?: number; random?: () => number } = {},
): Plan {
  const now = opts.now ?? Date.now();
  const random = opts.random ?? Math.random;
  const writes: PlanWrite[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const exists = new Set(target.map((d) => d.path));
  const add = (path: string, data: Record<string, unknown>) => {
    if (!exists.has(path)) writes.push({ path, data });
  };
  const at = (v: unknown) => ts(ms(v) ?? now);

  // Classes keep their 6-digit code unless it is already used in the new platform.
  const takenCodes = new Set(
    target.filter((d) => d.path.startsWith('joinCodes/')).map((d) => d.path.slice(10)),
  );
  const classById = new Map(rows.classes.map((c) => [c.id, c]));
  for (const c of rows.classes) {
    if (exists.has(`classes/${c.id}`)) continue;
    let code = c.join_code;
    if (!/^\d{6}$/.test(code) || takenCodes.has(code)) {
      const next = freshJoinCode(takenCodes, random);
      warnings.push(`Клас «${c.name}»: код ${code} вже зайнятий, новий код ${next}.`);
      code = next;
    } else takenCodes.add(code);
    add(`classes/${c.id}`, {
      name: clip(c.name, 40),
      grade: c.grade,
      joinCode: code,
      createdAt: at(c.created_at),
      archived: false,
    });
    add(`joinCodes/${code}`, { classId: c.id });
  }

  const names = new Map<string, string>();
  for (const s of rows.students) {
    names.set(s.id, clip(s.display_name, 60));
    if (!classById.has(s.class_id)) continue;
    const pictures = s.secret_kind === 'pictures';
    add(`classes/${s.class_id}/roster/${s.id}`, {
      displayName: clip(s.display_name, 60),
      secretKind: pictures ? 'pictures' : 'password',
      // Old passwords are 3 pictures; new ones get 4 when the teacher reissues them.
      ...(pictures ? { pictureCount: s.secret.split('-').length } : {}),
      createdAt: at(s.created_at),
    });
    add(`studentSecrets/${s.id}`, {
      classId: s.class_id,
      secret: secretFor(s.secret_kind, s.secret),
    });
  }

  for (const q of rows.quizzes) {
    if (!q.questions.length) {
      warnings.push(`Тест «${q.title}» без питань не перенесено.`);
      continue;
    }
    add(`quizzes/${q.id}`, {
      title: clip(q.title, 200),
      folder: '',
      questions: q.questions,
      createdAt: at(q.created_at),
      updatedAt: at(q.updated_at),
    });
  }

  let subs = 0;
  for (const a of rows.assignments) {
    const mine = rows.submissions.filter((s) => s.assignment_id === a.id);
    const inClass = assignmentResults(
      a.questions,
      mine.map((s) => ({
        studentId: s.student_id,
        attempt: s.attempt,
        answers: s.answers,
        submittedAt: ms(s.submitted_at),
      })),
    );
    add(`assignments/${a.id}`, {
      classId: a.class_id,
      kind: 'homework',
      quizId: a.quiz_id ?? '',
      title: clip(a.title, 200),
      questions: publicQuestions(a.questions),
      dueAt: ms(a.due_at) === null ? null : at(a.due_at),
      maxAttempts: a.max_attempts,
      reveal: a.show_correct ? 'immediate' : 'never',
      revealNow: false,
      roomId: null,
      createdAt: at(a.created_at),
      summary: { ...summarize(inClass.values()), updatedAt: ts(now) },
    });
    add(`assignmentKeys/${a.id}`, { questions: a.questions });
    for (const s of mine) {
      add(`submissions/${a.id}_${s.student_id}_${s.attempt}`, {
        assignmentId: a.id,
        classId: a.class_id,
        studentId: s.student_id,
        attempt: s.attempt,
        answers: s.answers,
        submittedAt: at(s.submitted_at),
      });
      subs++;
    }
  }

  let games = 0;
  const unfinished = rows.live_sessions.filter((g) => g.status !== 'finished').length;
  for (const g of rows.live_sessions.filter((x) => x.status === 'finished')) {
    const cls = classById.get(g.class_id);
    const results = rows.live_results.filter((r) => r.session_id === g.id);
    if (!cls || !results.length) continue;
    const total = Math.max(...results.map((r) => r.total));
    const players: Record<string, unknown> = {};
    const tally = new Map<string, PlayerTally>();
    for (const r of results) {
      players[r.student_id] = {
        name: names.get(r.student_id) ?? '—',
        score: r.score,
        correct: r.correct_count,
        last: null,
      };
      tally.set(r.student_id, {
        studentId: r.student_id,
        score: r.score,
        correctCount: r.correct_count,
        answers: new Map(),
      });
    }
    const junior = cls.grade <= 4;
    const finishedAt = at(g.ended_at ?? g.created_at);
    add(`games/${g.id}`, {
      classId: g.class_id,
      className: clip(cls.name, 40),
      quizId: g.quiz_id ?? '',
      title: clip(g.title, 200),
      questions: publicQuestions(g.questions),
      status: 'finished',
      index: Math.max(0, total - 1),
      deadline: null,
      starts: {},
      junior,
      players,
      leaderboard: junior
        ? []
        : leaderboard(tally, names).map(({ name, score }) => ({ name, score })),
      createdAt: at(g.created_at),
      finishedAt,
      active: false,
    });
    add(`gameKeys/${g.id}`, { questions: g.questions });
    for (const r of results) {
      add(`gameResults/${g.id}_${r.student_id}`, {
        gameId: g.id,
        classId: g.class_id,
        studentId: r.student_id,
        score: r.score,
        correctCount: r.correct_count,
        total: r.total,
        answers: r.answers,
        finishedAt,
      });
    }
    games++;
  }

  notes.push(
    `ІнфоКлас: ${rows.classes.length} класів, ${rows.students.length} учнів, ${rows.quizzes.length} тестів, ` +
      `${rows.assignments.length} завдань, ${subs} здач, ${games} ігор.`,
  );
  if (unfinished) notes.push(`Не переносяться ${unfinished} незавершених ігор.`);
  return { writes, notes, warnings };
}
