/*
 * Перенос из Клас-пульта (коллекции того же проекта Firebase), docs/platform/MIGRATION.md §2:
 *
 *   tests/{id} + keys/{id}   → quizzes/{id}           (вопрос {text, options[]} + индекс ответа)
 *   sessions/{id}            → assignments/{id} kind "lesson", legacy + assignmentKeys/{id}
 *                              (класс — по classLabel: существующий с тем же названием или новый)
 *   results/{id} с sessionId → guestResults/{id}     (по ПК и имени: учеников тогда не было в списках)
 *   results без sessionId, control, students, reveals — не переносятся;
 *   secret, setup, teachers, clock остаются на месте.
 */
import type { AnswerMap, Question } from '@infoklas/shared';
import type { DumpDoc } from './dump';
import {
  OPTION_IDS,
  freshJoinCode,
  gradeFromName,
  lessonSummary,
  ms,
  normalizeName,
  publicQuestions,
  ts,
  type Plan,
  type PlanWrite,
} from './plan';

interface OldQuestion {
  text?: unknown;
  options?: unknown;
}

export interface KlasPultOptions {
  /** Grade for class names without a digit: {"Гурток": 7}. */
  grades?: Record<string, number>;
  now?: number;
  random?: () => number;
}

const str = (v: unknown, max: number) =>
  String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

/** Old questions + key → questions of the platform (type "single"); null if unusable. */
export function convertQuestions(
  questions: unknown,
  key: unknown,
): { questions: Question[] } | { error: string } {
  if (!Array.isArray(questions) || !questions.length) return { error: 'немає питань' };
  if (!Array.isArray(key)) return { error: 'немає правильних відповідей (keys)' };
  if (questions.length > 50) return { error: `${questions.length} питань (більше 50)` };
  const out: Question[] = [];
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i] as OldQuestion;
    const options = Array.isArray(q.options) ? q.options.map((o) => str(o, 300)) : [];
    const correct = key[i];
    if (options.length < 2 || options.length > OPTION_IDS.length) {
      return { error: `питання ${i + 1}: ${options.length} варіантів` };
    }
    if (typeof correct !== 'number' || correct < 0 || correct >= options.length) {
      return { error: `питання ${i + 1}: немає правильної відповіді` };
    }
    out.push({
      id: `q${i + 1}`,
      type: 'single',
      prompt: str(q.text, 1000) || `Питання ${i + 1}`,
      timeLimitSec: 30,
      options: options.map((text, oi) => ({ id: OPTION_IDS[oi]!, text: text || '—' })),
      correctOptionId: OPTION_IDS[correct]!,
    });
  }
  return { questions: out };
}

/** Old answers [1, -1, 0] → {q1: "b", q3: "a"} (-1 = no answer). */
export function convertAnswers(answers: unknown, questions: Question[]): AnswerMap {
  const out: AnswerMap = {};
  if (!Array.isArray(answers)) return out;
  questions.forEach((q, i) => {
    const a = answers[i];
    if (q.type !== 'text' && typeof a === 'number' && a >= 0 && a < q.options.length) {
      out[q.id] = q.options[a]!.id;
    }
  });
  return out;
}

/**
 * @param source every document of the old project (backup JSON)
 * @param target documents already in the new collections (classes, joinCodes, quizzes…)
 */
export function planKlasPult(
  source: DumpDoc[],
  target: DumpDoc[],
  opts: KlasPultOptions = {},
): Plan {
  const now = opts.now ?? Date.now();
  const random = opts.random ?? Math.random;
  const writes: PlanWrite[] = [];
  const notes: string[] = [];
  const warnings: string[] = [];
  const byCol = (docs: DumpDoc[], col: string) =>
    docs
      .filter((d) => d.path.split('/').length === 2 && d.path.startsWith(`${col}/`))
      .map((d) => ({ id: d.path.slice(col.length + 1), data: d.data }));
  const exists = new Set(target.map((d) => d.path));

  // --- Bank: tests + keys → quizzes -------------------------------------------------
  const keys = new Map(byCol(source, 'keys').map((k) => [k.id, k.data.answers]));
  let quizzes = 0;
  for (const t of byCol(source, 'tests')) {
    const title = str(t.data.title, 200) || 'Без назви';
    const conv = convertQuestions(t.data.questions, keys.get(t.id));
    if ('error' in conv) {
      warnings.push(`Тест «${title}» не перенесено: ${conv.error}.`);
      continue;
    }
    if (exists.has(`quizzes/${t.id}`)) continue;
    const at = ms(t.data.updatedAt) ?? now;
    writes.push({
      path: `quizzes/${t.id}`,
      data: {
        title,
        folder: str(t.data.folder, 60),
        questions: conv.questions,
        createdAt: ts(at),
        updatedAt: ts(at),
      },
    });
    quizzes++;
  }
  notes.push(`Банк тестів: ${quizzes} нових тестів.`);

  // --- Classes by classLabel ------------------------------------------------------------
  const classes = new Map<string, string>(); // normalized name → classId
  for (const c of byCol(target, 'classes')) {
    classes.set(normalizeName(String(c.data.name ?? '')), c.id);
  }
  const takenCodes = new Set(byCol(target, 'joinCodes').map((j) => j.id));
  const newClasses: string[] = [];
  const classFor = (label: string): string | null => {
    const name = str(label, 40) || 'Без назви';
    const norm = normalizeName(name);
    const known = classes.get(norm);
    if (known) return known;
    const grade =
      opts.grades?.[name] ??
      Object.entries(opts.grades ?? {}).find(([k]) => normalizeName(k) === norm)?.[1] ??
      gradeFromName(name);
    if (!grade || grade < 2 || grade > 9) return null;
    const id = `kp_${[...norm].map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? ch : '_')).join('')}`;
    const joinCode = freshJoinCode(takenCodes, random);
    writes.push({
      path: `classes/${id}`,
      data: { name, grade, joinCode, createdAt: ts(now), archived: false },
    });
    writes.push({ path: `joinCodes/${joinCode}`, data: { classId: id } });
    classes.set(norm, id);
    newClasses.push(`${name} (${grade} клас, код ${joinCode})`);
    return id;
  };

  // --- Sessions → lesson assignments; results → guest results ----------------------------
  const results = byCol(source, 'results');
  const noSession = results.filter((r) => !r.data.sessionId).length;
  const needGrade = new Set<string>();
  let sessions = 0;
  let guests = 0;
  for (const s of byCol(source, 'sessions')) {
    const title = str(s.data.title, 200) || 'Тест';
    const conv = convertQuestions(s.data.questions, s.data.answers);
    const label = str(s.data.classLabel, 40);
    if ('error' in conv) {
      warnings.push(`Історія «${title}» (${label || 'без назви'}) не перенесена: ${conv.error}.`);
      continue;
    }
    const classId = classFor(label);
    if (!classId) {
      needGrade.add(label || 'Без назви');
      continue;
    }
    const at = ms(s.data.startedAt) ?? ms(s.data.lastSentAt) ?? now;
    const mine = results
      .filter((r) => r.data.sessionId === s.id)
      .map((r) => ({
        id: r.id,
        pcId: String(r.data.pc ?? ''),
        name: str(r.data.name, 60) || '—',
        answers: convertAnswers(r.data.answers, conv.questions),
        submittedAt: ms(r.data.submittedAt),
      }))
      .filter((r) => {
        if (/^pc\d{2}$/.test(r.pcId)) return true;
        warnings.push(`Відповідь ${r.id} без номера ПК пропущено.`);
        return false;
      });
    if (!exists.has(`assignments/${s.id}`)) {
      writes.push({
        path: `assignments/${s.id}`,
        data: {
          classId,
          kind: 'lesson',
          quizId: String(s.data.testId ?? ''),
          title,
          questions: publicQuestions(conv.questions),
          dueAt: null,
          maxAttempts: 1,
          reveal: 'never',
          revealNow: false,
          roomId: null,
          createdAt: ts(at),
          legacy: true,
          summary: { ...lessonSummary(conv.questions, mine), updatedAt: ts(now) },
        },
      });
      writes.push({ path: `assignmentKeys/${s.id}`, data: { questions: conv.questions } });
      sessions++;
    }
    for (const r of mine) {
      if (exists.has(`guestResults/${r.id}`)) continue;
      writes.push({
        path: `guestResults/${r.id}`,
        data: {
          assignmentId: s.id,
          pcId: r.pcId,
          name: r.name,
          answers: r.answers,
          submittedAt: ts(r.submittedAt ?? at),
        },
      });
      guests++;
    }
  }
  if (newClasses.length) notes.push(`Нові класи: ${newClasses.join(', ')}.`);
  notes.push(`Історія: ${sessions} тестів уроків, ${guests} відповідей учнів (за ПК та ім’ям).`);
  if (noSession) {
    notes.push(
      `Не переносяться ${noSession} відповідей без сесії (до 25.09.2026, їх немає і в Історії Клас-пульта).`,
    );
  }
  for (const n of needGrade) {
    warnings.push(
      `Клас «${n}»: не видно року навчання. Запустіть ще раз з --grade "${n}=5" (свій рік).`,
    );
  }
  return { writes, notes, warnings };
}
