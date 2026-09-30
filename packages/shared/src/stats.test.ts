import { describe, expect, it } from 'vitest';
import type { Question } from './quiz.js';
import { lessonRows } from './results.js';
import {
  avgText,
  distributionBins,
  historyCsv,
  historyFileName,
  historyStats,
  historySummary,
} from './stats.js';

const single = (id: string, correct: string): Question => ({
  id,
  type: 'single',
  prompt: `Питання ${id}`,
  timeLimitSec: 30,
  options: ['a', 'b', 'c'].map((o) => ({ id: o, text: o.toUpperCase() })),
  correctOptionId: correct,
});
const questions: Question[] = [
  single('q1', 'a'),
  single('q2', 'b'),
  { id: 'q3', type: 'text', prompt: 'Столиця?', timeLimitSec: 30, acceptedAnswers: ['Київ'] },
];

const rows = lessonRows({
  questions,
  submissions: [
    // A pupil of the class: the best attempt counts.
    { studentId: 's1', attempt: 1, answers: { q1: 'b' }, submittedAt: 1, pcId: 'pc03' },
    {
      studentId: 's1',
      attempt: 2,
      answers: { q1: 'a', q2: 'b', q3: 'київ' },
      submittedAt: 2,
      pcId: 'pc03',
    },
  ],
  guests: [
    // A guest PC resubmitted: the last one counts (as in Клас-пульт).
    { pcId: 'pc07', name: 'Гість', answers: { q1: 'c' }, submittedAt: 5 },
    { pcId: 'pc07', name: 'Гість', answers: { q1: 'a', q2: 'c' }, submittedAt: 9 },
    { pcId: 'pc01', name: '=Хакер', answers: {}, submittedAt: 3 },
  ],
  names: new Map([['s1', 'Оля К.']]),
});

describe('historyStats (Клас-пульт stats.js)', () => {
  const s = historyStats(questions, rows);

  it('scores, average from the mean score, distribution', () => {
    expect(s.rows.map((r) => [r.pcId, r.correctCount])).toEqual([
      ['pc01', 0],
      ['pc03', 3],
      ['pc07', 1],
    ]);
    expect(s.submitted).toBe(3);
    expect(s.avg).toBeCloseTo(4 / 3);
    // Клас-пульт: percent(avg, total) = round(1.333 / 3 * 100) = 44.
    expect(s.avgPercent).toBe(44);
    expect(avgText(s.avg)).toBe('1,3');
    expect(s.distribution).toEqual([1, 1, 0, 1]);
    expect(historySummary(s)).toEqual({ submitted: 3, avgPercent: 44 });
  });

  it('per question: options chosen, no answer, share correct, the hardest', () => {
    const [q1, q2, q3] = s.perQuestion;
    expect(q1!.options!.map((o) => [o.id, o.count, o.correct])).toEqual([
      ['a', 2, true],
      ['b', 0, false],
      ['c', 0, false],
    ]);
    expect([q1!.none, q1!.correct, q1!.percent]).toEqual([1, 2, 67]);
    expect([q2!.none, q2!.correct, q2!.percent]).toEqual([1, 1, 33]);
    expect(q3!.options).toBeNull();
    expect([q3!.none, q3!.correct, q3!.percent]).toEqual([2, 1, 33]);
    expect(s.hardest!.index).toBe(1);
  });

  it('no submissions: zeros and no hardest question', () => {
    const e = historyStats(questions, []);
    expect([e.submitted, e.avg, e.avgPercent, e.hardest]).toEqual([0, 0, 0, null]);
    expect(e.distribution).toEqual([0, 0, 0, 0]);
  });

  it('more than 20 questions: 10 % bins', () => {
    const many = Array.from({ length: 25 }, (_, i) => single(`q${i + 1}`, 'a'));
    const r = lessonRows({
      questions: many,
      submissions: [],
      guests: [{ pcId: 'pc02', name: 'Х', answers: { q1: 'a', q2: 'a', q3: 'a' }, submittedAt: 1 }],
      names: new Map(),
    });
    const bins = distributionBins(historyStats(many, r));
    expect(bins).toHaveLength(10);
    expect(bins[1]).toEqual({ label: '10–19%', count: 1 });
    expect(bins[9]!.label).toBe('90–100%');
  });

  it('CSV for Excel as in Клас-пульт, a formula-looking name is neutralized', () => {
    const csv = historyCsv(s, [{ pcId: 'pc11', name: 'Петро' }]);
    expect(csv.split('\r\n')).toEqual([
      '﻿ПК;Учень;Статус;Бал;Максимум;Питання 1;Питання 2;Питання 3',
      "ПК 01;'=Хакер;здав(ла);0;3;;;",
      'ПК 03;Оля К.;здав(ла);3;3;1;1;1',
      'ПК 07;Гість;здав(ла);1;3;1;0;',
      'ПК 11;Петро;не здав(ла);;3',
      '',
    ]);
    expect(historyFileName('Мережі: вступ', '6-В', new Date(2026, 8, 29, 10).getTime())).toBe(
      'Результати - Мережі вступ - 6-В - 2026-09-29.csv',
    );
  });
});
