// The scenarios of the old server test (apps/server/src/test/live.test.ts),
// now for the pure host logic that runs in the teacher's browser.
import { describe, expect, it } from 'vitest';
import {
  everyoneAnswered,
  gameResults,
  leaderboard,
  nextStep,
  optionStats,
  questionPoints,
  revealInfo,
  tally,
  textAnswers,
  type GameAnswer,
} from './game.js';
import type { Question } from './quiz.js';
import { buildJournal } from './results.js';

const questions: Question[] = [
  {
    id: 'q1',
    type: 'single',
    prompt: 'Скільки бітів у байті?',
    timeLimitSec: 20,
    options: [
      { id: 'a', text: '4' },
      { id: 'b', text: '8' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q2',
    type: 'multiple',
    prompt: 'Пристрої введення',
    timeLimitSec: 20,
    options: [
      { id: 'a', text: 'Клавіатура' },
      { id: 'b', text: 'Монітор' },
      { id: 'c', text: 'Миша' },
    ],
    correctOptionIds: ['a', 'c'],
  },
  {
    id: 'q3',
    type: 'text',
    prompt: 'Найменша одиниця інформації',
    timeLimitSec: 30,
    acceptedAnswers: ['біт'],
  },
];
const starts = { '0': 10_000, '1': 50_000, '2': 90_000 };
const names = new Map([
  ['anya', 'Аня'],
  ['borys', 'Борис'],
]);
const ans = (
  studentId: string,
  index: number,
  value: GameAnswer['value'],
  at: number,
): GameAnswer => ({
  studentId,
  index,
  value,
  at,
});
const players = ['anya', 'borys'];

describe('live game host logic', () => {
  it('runs a full game: auto reveal, stats, speed bonus, text answers, journal rows', () => {
    const q1 = [ans('anya', 0, 'b', 12_000), ans('borys', 0, 'a', 15_000)];
    expect(everyoneAnswered(players, q1, 0)).toBe(true);
    expect(everyoneAnswered(players, q1.slice(0, 1), 0)).toBe(false);
    expect(optionStats(questions[0]!, q1, 0)).toEqual({ a: 1, b: 1 });
    expect(revealInfo(questions[0]!)).toEqual({ correctIds: ['b'], correctText: '8' });

    let t = tally({ questions, answers: q1, players, asked: 1, starts, junior: false });
    expect(t.get('anya')!.answers.get(0)).toMatchObject({ correct: true });
    expect(t.get('anya')!.score).toBeGreaterThan(500);
    expect(t.get('borys')!.score).toBe(0);
    expect(leaderboard(t, names)[0]).toMatchObject({ name: 'Аня' });

    // Q2: Borys doesn't answer — the teacher reveals by hand.
    const q2 = [ans('anya', 1, ['c', 'a'], 52_000)];
    expect(everyoneAnswered(players, [...q1, ...q2], 1)).toBe(false);
    const q3 = [ans('borys', 2, 'Біт', 95_000), ans('anya', 2, 'байт', 96_000)];
    const all = [...q1, ...q2, ...q3];
    expect(textAnswers(questions[2]!, all, 2, names)).toEqual([
      { name: 'Борис', value: 'Біт', correct: true },
      { name: 'Аня', value: 'байт', correct: false },
    ]);

    t = tally({ questions, answers: all, players, asked: 3, starts, junior: false });
    const rows = gameResults(t, questions, 3);
    expect(rows.find((r) => r.studentId === 'anya')).toMatchObject({ correctCount: 2, total: 3 });
    expect(rows.find((r) => r.studentId === 'borys')).toMatchObject({ correctCount: 1, total: 3 });
    expect(nextStep(2, 3)).toEqual({ status: 'finished' });
    expect(nextStep(0, 3)).toEqual({ status: 'question', index: 1 });

    const j = buildJournal({
      students: [
        { id: 'anya', displayName: 'Аня' },
        { id: 'borys', displayName: 'Борис' },
      ],
      assignments: [],
      submissions: [],
      games: [{ id: 'g1', title: 'Бліц', date: 1, results: rows }],
    });
    expect(j.columns).toEqual([{ id: 'g1', kind: 'live', title: 'Бліц', date: 1 }]);
    expect(j.cells['anya:g1']).toEqual({ correctCount: 2, total: 3 });
  });

  it('primary school: every correct answer is 100 points, no speed pressure', () => {
    expect(questionPoints(true, questions[0]!, 10_000, 19_000)).toBe(100);
    expect(questionPoints(false, questions[0]!, 10_000, 10_000)).toBe(1000);
    expect(questionPoints(false, questions[0]!, 10_000, 40_000)).toBe(500);
    const t = tally({
      questions,
      answers: [ans('anya', 0, 'b', 11_000)],
      players,
      asked: 1,
      starts,
      junior: true,
    });
    expect(t.get('anya')!.score).toBe(100);
  });

  it('counts only the questions asked when the teacher ends early', () => {
    const answers = [ans('anya', 0, 'b', 12_000), ans('anya', 1, ['a', 'c'], 52_000)];
    const t = tally({ questions, answers, players: ['anya'], asked: 1, starts, junior: false });
    expect(gameResults(t, questions, 1)).toEqual([
      expect.objectContaining({ studentId: 'anya', correctCount: 1, total: 1 }),
    ]);
  });

  it('a game ended in the lobby gives nothing for the journal', () => {
    const t = tally({ questions, answers: [], players, asked: 0, starts: {}, junior: false });
    expect(gameResults(t, questions, 0)).toEqual([]);
  });

  it('only the first answer to a question counts', () => {
    const answers = [ans('anya', 0, 'a', 12_000), ans('anya', 0, 'b', 13_000)];
    const t = tally({ questions, answers, players: ['anya'], asked: 1, starts, junior: false });
    expect(t.get('anya')!.correctCount).toBe(0);
    expect(optionStats(questions[0]!, answers, 0)).toEqual({ a: 1, b: 0 });
  });
});
