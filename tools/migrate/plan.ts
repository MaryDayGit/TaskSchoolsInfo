/*
 * Общее для переносов: план — список документов, которые нужно СОЗДАТЬ.
 * Перенос только добавляет: существующий документ не меняется (при записи
 * create() с ошибкой ALREADY_EXISTS считается «уже был»).
 *
 * Значения в плане — в виде JSON резервной копии (dump.ts): время — {"__ts": мс}.
 */
import {
  historyStats,
  historySummary,
  lessonRows,
  toPublicQuestion,
  type AnswerMap,
  type Question,
} from '@infoklas/shared';

export interface PlanWrite {
  path: string;
  data: Record<string, unknown>;
}

export interface Plan {
  writes: PlanWrite[];
  /** Human-readable lines for the dry run report (Ukrainian, for the teacher). */
  notes: string[];
  warnings: string[];
}

export const ts = (ms: number) => ({ __ts: ms });

/** Milliseconds from a dump value ({__ts}), a Date, ISO text or a number. */
export function ms(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  if (typeof v === 'object' && typeof (v as { __ts?: unknown }).__ts === 'number') {
    return (v as { __ts: number }).__ts;
  }
  return null;
}

export const OPTION_IDS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

/** Same words for the same class name: «6-а», « 6-А » → «6-а». */
export const normalizeName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** «5-А» → 5, «7 клас» → 7; a name without a digit 2–9 needs --grade. */
export function gradeFromName(name: string): number | null {
  const m = /(^|\D)([2-9])(?!\d)/.exec(name);
  return m ? Number(m[2]) : null;
}

/** A new 6-digit class code not in `taken` (the set is updated). */
export function freshJoinCode(taken: Set<string>, random: () => number): string {
  for (;;) {
    const code = String(Math.floor(random() * 1_000_000)).padStart(6, '0');
    if (!taken.has(code)) {
      taken.add(code);
      return code;
    }
  }
}

/** The short History summary, computed the same way as the cabinet does. */
export function lessonSummary(
  questions: Question[],
  guests: { pcId: string; name: string; answers: AnswerMap; submittedAt: number | null }[],
) {
  const stats = historyStats(
    questions,
    lessonRows({ questions, submissions: [], guests, names: new Map() }),
  );
  return historySummary(stats);
}

export const publicQuestions = (qs: Question[]) => qs.map(toPublicQuestion);

/** Counts of planned documents by collection («classes», «classes/*\/roster»). */
export function countWrites(writes: { path: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const w of writes) {
    const key = w.path
      .split('/')
      .slice(0, -1)
      .map((p, i) => (i % 2 ? '*' : p))
      .join('/');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}
