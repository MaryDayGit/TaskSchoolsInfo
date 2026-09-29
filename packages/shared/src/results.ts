/*
 * Results of assignments and the class journal, computed in the teacher's cabinet.
 *
 * Students only send raw answers (`submissions`); every score here is recomputed
 * from those answers and the answer key with `gradeAnswers()`. A score field a
 * student might add to a submission is never read (see ARCHITECTURE.md, Р6).
 */
import { toCsv } from './csv.js';
import { gradeAnswers, type AnswerMap, type Question } from './grading.js';

export interface Score {
  correctCount: number;
  total: number;
}

/** A submission as stored: only these fields are used. */
export interface RawSubmission {
  studentId: string;
  attempt: number;
  answers: AnswerMap;
  /** Milliseconds; `null` while the server time is not known yet. */
  submittedAt: number | null;
}

export interface StudentResult extends Score {
  studentId: string;
  attempts: number;
  /** Number of the attempt with the best score (the earliest of equal ones). */
  bestAttempt: number;
  lastSubmittedAt: number | null;
  /** Per question of the best attempt: answered correctly? */
  perQuestion: boolean[];
  /** Answers of the best attempt, to show what the student chose. */
  answers: AnswerMap;
}

export function percent(correct: number, total: number): number {
  return total > 0 ? Math.round((100 * correct) / total) : 0;
}

/** Best attempt of every student who submitted. */
export function assignmentResults(
  questions: Question[],
  submissions: RawSubmission[],
): Map<string, StudentResult> {
  const out = new Map<string, StudentResult>();
  const sorted = [...submissions].sort((a, b) => a.attempt - b.attempt);
  for (const s of sorted) {
    const g = gradeAnswers(questions, s.answers ?? {});
    const prev = out.get(s.studentId);
    const last = Math.max(prev?.lastSubmittedAt ?? 0, s.submittedAt ?? 0) || null;
    if (!prev || g.correctCount > prev.correctCount) {
      out.set(s.studentId, {
        studentId: s.studentId,
        correctCount: g.correctCount,
        total: g.total,
        attempts: (prev?.attempts ?? 0) + 1,
        bestAttempt: s.attempt,
        lastSubmittedAt: last,
        perQuestion: g.perQuestion.map((p) => p.correct),
        answers: s.answers ?? {},
      });
    } else {
      prev.attempts += 1;
      prev.lastSubmittedAt = last;
    }
  }
  return out;
}

/** The short summary kept on the assignment for lists: how many submitted, average %. */
export function summarize(results: Iterable<StudentResult>): {
  submitted: number;
  avgPercent: number;
} {
  const list = [...results];
  const sum = list.reduce((acc, r) => acc + percent(r.correctCount, r.total), 0);
  return { submitted: list.length, avgPercent: list.length ? Math.round(sum / list.length) : 0 };
}

/** How many students chose each option / answered each question correctly. */
export function questionStats(questions: Question[], results: Iterable<StudentResult>) {
  const list = [...results];
  return questions.map((q, i) => ({
    questionId: q.id,
    correct: list.filter((r) => r.perQuestion[i]).length,
    answered: list.filter((r) => r.answers[q.id] !== undefined).length,
  }));
}

// ---------------------------------------------------------------------------
// Journal: students × works

export interface JournalStudent {
  id: string;
  displayName: string;
}

export interface JournalColumn {
  id: string;
  kind: 'homework' | 'lesson' | 'live';
  title: string;
  /** Milliseconds. */
  date: number;
}

export interface JournalAssignment extends JournalColumn {
  /** Questions with answers (from the key). */
  questions: Question[];
}

export interface Journal {
  students: JournalStudent[];
  columns: JournalColumn[];
  /** Keyed by `${studentId}:${columnId}`: the best attempt. */
  cells: Record<string, Score>;
}

export interface JournalGame {
  id: string;
  title: string;
  /** Milliseconds. */
  date: number;
  /** gameResults written by the host at the end (scores computed by the host). */
  results: { studentId: string; correctCount: number; total: number }[];
}

export function buildJournal(input: {
  students: JournalStudent[];
  assignments: JournalAssignment[];
  submissions: (RawSubmission & { assignmentId: string })[];
  games?: JournalGame[];
}): Journal {
  const students = [...input.students].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, 'uk'),
  );
  const known = new Set(students.map((s) => s.id));
  const games = input.games ?? [];
  const columns: JournalColumn[] = [
    ...input.assignments.map(({ id, kind, title, date }) => ({ id, kind, title, date })),
    ...games.map(({ id, title, date }) => ({ id, kind: 'live' as const, title, date })),
  ].sort((a, b) => a.date - b.date);

  const cells: Journal['cells'] = {};
  for (const a of input.assignments) {
    const subs = input.submissions.filter((s) => s.assignmentId === a.id && known.has(s.studentId));
    for (const r of assignmentResults(a.questions, subs).values()) {
      cells[`${r.studentId}:${a.id}`] = { correctCount: r.correctCount, total: r.total };
    }
  }
  for (const g of games) {
    for (const r of g.results) {
      if (known.has(r.studentId))
        cells[`${r.studentId}:${g.id}`] = { correctCount: r.correctCount, total: r.total };
    }
  }
  return { students, columns, cells };
}

export function journalToCsv(j: Journal): string {
  const rows = [['Учень', ...j.columns.map((c) => c.title)]];
  for (const s of j.students) {
    rows.push([
      s.displayName,
      ...j.columns.map((c) => {
        const cell = j.cells[`${s.id}:${c.id}`];
        return cell && cell.total > 0 ? `${percent(cell.correctCount, cell.total)}%` : '';
      }),
    ]);
  }
  return toCsv(rows);
}

// ---------------------------------------------------------------------------
// A test on the lesson: pupils from the class list and guests (PC number + name)

export interface GuestSubmission {
  pcId: string;
  name: string;
  answers: AnswerMap;
  submittedAt: number | null;
}

export interface LessonRow extends Score {
  /** studentId, or `guest:pc07` for a guest. */
  key: string;
  studentId: string | null;
  pcId: string | null;
  name: string;
  perQuestion: boolean[];
  answers: AnswerMap;
}

/**
 * Rows for the lesson results table: each pupil's best attempt and each guest
 * PC's latest answers (as in Клас-пульт, a PC may resubmit).
 */
export function lessonRows(input: {
  questions: Question[];
  submissions: (RawSubmission & { pcId?: string | null })[];
  guests: GuestSubmission[];
  names: Map<string, string>;
}): LessonRow[] {
  const rows: LessonRow[] = [];
  const best = assignmentResults(input.questions, input.submissions);
  for (const r of best.values()) {
    const sub = input.submissions.find(
      (s) => s.studentId === r.studentId && s.attempt === r.bestAttempt,
    );
    rows.push({
      key: r.studentId,
      studentId: r.studentId,
      pcId: sub?.pcId ?? null,
      name: input.names.get(r.studentId) ?? '—',
      correctCount: r.correctCount,
      total: r.total,
      perQuestion: r.perQuestion,
      answers: r.answers,
    });
  }
  const latest = new Map<string, GuestSubmission>();
  for (const g of input.guests) {
    const prev = latest.get(g.pcId);
    if (!prev || (g.submittedAt ?? Infinity) >= (prev.submittedAt ?? Infinity))
      latest.set(g.pcId, g);
  }
  for (const g of latest.values()) {
    const graded = gradeAnswers(input.questions, g.answers ?? {});
    rows.push({
      key: `guest:${g.pcId}`,
      studentId: null,
      pcId: g.pcId,
      name: g.name,
      correctCount: graded.correctCount,
      total: graded.total,
      perQuestion: graded.perQuestion.map((p) => p.correct),
      answers: g.answers ?? {},
    });
  }
  const num = (r: LessonRow) => (r.pcId ? Number(r.pcId.slice(2)) : 1000);
  return rows.sort((a, b) => num(a) - num(b) || a.name.localeCompare(b.name, 'uk'));
}
