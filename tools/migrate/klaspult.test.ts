import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { historyStats, lessonRows, type Question } from '@infoklas/shared';
import { convertAnswers, convertQuestions, planKlasPult } from './klaspult';
import { legacyCompute } from './legacyStats';
import { countWrites, gradeFromName, ms, type PlanWrite } from './plan';
import { klasPultFixture, seeded } from './test/fixtures';

/** The real public/stats.js of Клас-пульт with the helpers it uses from common.js. */
function realKlasPultStats() {
  const App = {
    ok: true,
    h: () => null,
    PC_MIN: 1,
    PC_MAX: 99,
    pcNum(value: unknown) {
      const s = String(value ?? '')
        .trim()
        .replace(/^pc/i, '');
      if (!/^0*\d{1,2}$/.test(s)) return null;
      const n = parseInt(s, 10);
      return n >= 1 && n <= 99 ? n : null;
    },
    pcLabel: (num: number) => String(num).padStart(2, '0'),
    toMillis(value: unknown) {
      if (!value) return 0;
      if (typeof value === 'number') return value;
      const v = value as { toMillis?: () => number };
      return typeof v.toMillis === 'function' ? v.toMillis() : 0;
    },
    plural: () => '',
  } as Record<string, unknown>;
  const code = readFileSync(new URL('./test/klas-pult-stats.js', import.meta.url), 'utf8');
  runInNewContext(code, { window: { App }, document: {}, URL, Blob: class {}, setTimeout });
  return App.Stats as {
    compute(
      session: unknown,
      results: unknown[],
    ): { rows: { pc: string; name: string; score: number }[]; avgPercent: number; total: number };
  };
}

/** Dump values → what the Firestore client gives Клас-пульт (Timestamp-like). */
const live = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(live);
  if (v && typeof v === 'object') {
    const t = ms(v);
    if (t !== null && '__ts' in v) return { toMillis: () => t };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, live(x)]));
  }
  return v;
};

const source = klasPultFixture();
const col = (name: string) =>
  source
    .filter((d) => d.path.startsWith(`${name}/`))
    .map((d) => ({ id: d.path.slice(name.length + 1), data: d.data }));

describe('Клас-пульт scores', () => {
  it('legacyStats.ts gives exactly what the real stats.js of Клас-пульт gives', () => {
    const Stats = realKlasPultStats();
    for (const s of col('sessions')) {
      const results = col('results')
        .filter((r) => r.data.sessionId === s.id)
        .map((r) => r.data);
      const real = Stats.compute(live(s.data), results.map(live));
      const mine = legacyCompute(s.data, results);
      expect(mine.rows.map((r) => [r.pc, r.name, r.score])).toEqual(
        real.rows.map((r) => [r.pc, r.name, r.score]),
      );
      expect(mine.avgPercent).toBe(real.avgPercent);
      expect(mine.total).toBe(real.total);
    }
  });

  it('after conversion the new History gives the same scores and average', () => {
    const Stats = realKlasPultStats();
    for (const s of col('sessions')) {
      const conv = convertQuestions(s.data.questions, s.data.answers);
      if ('error' in conv) throw new Error(conv.error);
      const results = col('results').filter((r) => r.data.sessionId === s.id);
      const real = Stats.compute(
        live(s.data),
        results.map((r) => live(r.data)),
      );
      const stats = historyStats(
        conv.questions,
        lessonRows({
          questions: conv.questions,
          submissions: [],
          guests: results.map((r) => ({
            pcId: String(r.data.pc),
            name: String(r.data.name),
            answers: convertAnswers(r.data.answers, conv.questions),
            submittedAt: ms(r.data.submittedAt),
          })),
          names: new Map(),
        }),
      );
      expect(stats.rows.map((r) => [r.pcId, r.correctCount])).toEqual(
        real.rows.map((r) => [r.pc, r.score]),
      );
      expect(stats.avgPercent).toBe(real.avgPercent);
    }
  });
});

describe('planKlasPult', () => {
  const byPath = (writes: PlanWrite[], path: string) => writes.find((w) => w.path === path)?.data;

  it('dry run: what will be created, what is left out and why', () => {
    const plan = planKlasPult(source, [], { now: 1, random: seeded(1) });
    const counts = countWrites(plan.writes);
    // 2 tests in the bank (the third was deleted); 5-А, 6-Б, 7-В, 8-А, 9-Б classes;
    // 11 sessions minus «Гурток» and the unlabeled one (no grade).
    expect(counts.quizzes).toBe(2);
    expect(counts.classes).toBe(5);
    expect(counts.joinCodes).toBe(5);
    expect(counts.assignments).toBe(9);
    expect(counts.assignmentKeys).toBe(9);
    expect(plan.warnings.join('\n')).toContain('Клас «Гурток»: не видно року навчання');
    expect(plan.warnings.join('\n')).toContain('Клас «Без назви»');
    expect(plan.notes.join('\n')).toContain('Не переносяться 1 відповідей без сесії');
    expect(counts.control).toBeUndefined();
    expect(counts.results).toBeUndefined();
  });

  it('the teacher gives grades for the other names; everything moves', () => {
    const plan = planKlasPult(source, [], {
      now: 1,
      random: seeded(1),
      grades: { Гурток: 7, 'Без назви': 5 },
    });
    expect(plan.warnings).toEqual([]);
    const counts = countWrites(plan.writes);
    expect(counts.assignments).toBe(11);
    const results = col('results').filter((r) => r.data.sessionId).length;
    expect(counts.guestResults).toBe(results);

    const quiz = byPath(plan.writes, 'quizzes/algo')!;
    expect(quiz.folder).toBe('5 клас');
    expect((quiz.questions as Question[])[1]).toEqual({
      id: 'q2',
      type: 'single',
      prompt: 'Виконавець робота?',
      timeLimitSec: 30,
      options: [
        { id: 'a', text: 'Людина' },
        { id: 'b', text: 'Робот' },
        { id: 'c', text: 'Кіт' },
        { id: 'd', text: 'Сонце' },
      ],
      correctOptionId: 'b',
    });

    const sid = `${Date.UTC(2026, 8, 25, 7, 0)}_algo`;
    const a = byPath(plan.writes, `assignments/${sid}`)!;
    expect(a).toMatchObject({
      classId: 'kp_5_а',
      kind: 'lesson',
      quizId: 'algo',
      title: 'Алгоритми',
      legacy: true,
      reveal: 'never',
      summary: { submitted: 3, avgPercent: 78 },
    });
    // Without answers: pupils can read assignments.
    expect(JSON.stringify(a.questions)).not.toContain('correctOptionId');
    const cls = byPath(plan.writes, 'classes/kp_5_а')!;
    expect(cls).toMatchObject({ name: '5-А', grade: 5, archived: false });
    expect(byPath(plan.writes, `joinCodes/${String(cls.joinCode)}`)).toEqual({
      classId: 'kp_5_а',
    });

    // The resubmission from PC 03 and «-1 = no answer».
    const guests = plan.writes.filter(
      (w) => w.path.startsWith('guestResults/') && w.data.assignmentId === sid,
    );
    expect(guests.map((g) => [g.data.pcId, g.data.name, g.data.answers])).toEqual([
      ['pc03', 'Оля К.', { q1: 'b', q2: 'b', q3: 'a' }],
      ['pc03', 'Оля К.', { q1: 'a', q2: 'b', q3: 'a' }],
      ['pc07', 'Петро М.', { q1: 'a', q3: 'b' }],
      ['pc12', 'Ірина', { q1: 'a', q2: 'b', q3: 'a' }],
    ]);
    expect(byPath(plan.writes, 'classes/kp_без_назви')).toMatchObject({ name: 'Без назви' });
  });

  it('an existing class with the same name is used; a second run adds nothing', () => {
    const target = [
      { path: 'classes/c6b', data: { name: '6-б', grade: 6, joinCode: '111111' } },
      { path: 'joinCodes/111111', data: { classId: 'c6b' } },
    ];
    const opts = { now: 1, random: seeded(2), grades: { Гурток: 7, 'Без назви': 5 } };
    const first = planKlasPult(source, target, opts);
    const sid = `${Date.UTC(2026, 8, 25, 7, 0) + 3_000_000}_net`;
    expect(byPath(first.writes, `assignments/${sid}`)!.classId).toBe('c6b');
    expect(first.writes.some((w) => w.path === 'classes/kp_6_б')).toBe(false);

    const after = [...target, ...first.writes];
    const again = planKlasPult(source, after, opts);
    expect(again.writes).toEqual([]);
  });

  it('bad old tests are reported, not moved', () => {
    expect(convertQuestions([], [])).toEqual({ error: 'немає питань' });
    expect(convertQuestions([{ text: 'x', options: ['a', 'b'] }], null)).toEqual({
      error: 'немає правильних відповідей (keys)',
    });
    expect(convertQuestions([{ text: 'x', options: ['a'] }], [0])).toEqual({
      error: 'питання 1: 1 варіантів',
    });
    expect(convertQuestions([{ text: 'x', options: ['a', 'b'] }], [5])).toEqual({
      error: 'питання 1: немає правильної відповіді',
    });
  });

  it('grade from a class name', () => {
    expect(gradeFromName('5-А')).toBe(5);
    expect(gradeFromName('7 клас')).toBe(7);
    expect(gradeFromName('10-А')).toBeNull();
    expect(gradeFromName('Гурток')).toBeNull();
  });
});
