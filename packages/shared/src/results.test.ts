import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv.js';
import type { Question } from './quiz.js';
import {
  assignmentResults,
  buildJournal,
  journalToCsv,
  questionStats,
  summarize,
  type RawSubmission,
} from './results.js';

const questions: Question[] = [
  {
    id: 'q1',
    type: 'single',
    prompt: '2 + 2?',
    timeLimitSec: 30,
    options: [
      { id: 'a', text: '4' },
      { id: 'b', text: '5' },
    ],
    correctOptionId: 'a',
  },
  { id: 'q2', type: 'text', prompt: 'Столиця?', timeLimitSec: 30, acceptedAnswers: ['Київ'] },
];

const sub = (
  studentId: string,
  attempt: number,
  answers: RawSubmission['answers'],
  at = attempt,
) => ({
  studentId,
  attempt,
  answers,
  submittedAt: at * 1000,
});

describe('assignmentResults', () => {
  it('takes the best attempt and counts attempts', () => {
    const r = assignmentResults(questions, [
      sub('ola', 1, { q1: 'b', q2: 'Львів' }),
      sub('ola', 2, { q1: 'a', q2: ' київ ' }),
      sub('ola', 3, { q1: 'a' }),
      sub('ivan', 1, { q1: 'a' }),
    ]);
    expect(r.get('ola')).toMatchObject({
      correctCount: 2,
      total: 2,
      attempts: 3,
      bestAttempt: 2,
      lastSubmittedAt: 3000,
      perQuestion: [true, true],
    });
    expect(r.get('ivan')).toMatchObject({ correctCount: 1, attempts: 1, bestAttempt: 1 });
    expect(summarize(r.values())).toEqual({ submitted: 2, avgPercent: 75 });
    expect(questionStats(questions, r.values())).toEqual([
      { questionId: 'q1', correct: 2, answered: 2 },
      { questionId: 'q2', correct: 1, answered: 1 },
    ]);
  });

  it('ignores a score the student wrote into the submission', () => {
    const forged = {
      ...sub('ola', 1, { q1: 'b', q2: 'Львів' }),
      correctCount: 2,
      total: 2,
      score: 100,
      percent: 100,
    };
    const r = assignmentResults(questions, [forged]);
    expect(r.get('ola')).toMatchObject({ correctCount: 0, total: 2 });

    const j = buildJournal({
      students: [{ id: 'ola', displayName: 'Оля К.' }],
      assignments: [{ id: 'hw1', kind: 'homework', title: 'ДЗ', date: 1, questions }],
      submissions: [{ ...forged, assignmentId: 'hw1' }],
    });
    expect(j.cells['ola:hw1']).toEqual({ correctCount: 0, total: 2 });
  });
});

describe('journal', () => {
  it('students sorted by name, works by date, deleted students skipped', () => {
    const j = buildJournal({
      students: [
        { id: 'petro', displayName: 'Петро М.' },
        { id: 'ola', displayName: 'Оля К.' },
      ],
      assignments: [
        { id: 'hw2', kind: 'homework', title: '=Друге', date: 200, questions },
        { id: 'hw1', kind: 'homework', title: 'Перше', date: 100, questions },
      ],
      submissions: [
        { ...sub('ola', 1, { q1: 'a', q2: 'Київ' }), assignmentId: 'hw1' },
        { ...sub('petro', 1, { q1: 'a' }), assignmentId: 'hw2' },
        { ...sub('gone', 1, { q1: 'a' }), assignmentId: 'hw1' },
      ],
    });
    expect(j.students.map((s) => s.id)).toEqual(['ola', 'petro']);
    expect(j.columns.map((c) => c.id)).toEqual(['hw1', 'hw2']);
    expect(Object.keys(j.cells).sort()).toEqual(['ola:hw1', 'petro:hw2']);
    expect(journalToCsv(j)).toBe("﻿Учень;Перше;'=Друге\r\nОля К.;100%;\r\nПетро М.;;50%\r\n");
  });
});

describe('csv', () => {
  it('neutralizes formulas and quotes separators', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@x')).toBe("'@x");
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('він сказав "так"')).toBe('"він сказав ""так"""');
    expect(csvCell('два\nрядки')).toBe('"два\nрядки"');
    expect(toCsv([['a', 'b']])).toBe('﻿a;b\r\n');
  });
});
