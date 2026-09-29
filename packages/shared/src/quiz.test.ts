import { describe, expect, it } from 'vitest';
import {
  gradeAnswers,
  isAnswerCorrect,
  normalizeText,
  questionSchema,
  quizInputSchema,
  toPublicQuestion,
  type Question,
} from './index.js';

const single: Question = {
  id: 'q1',
  type: 'single',
  prompt: '2 + 2?',
  timeLimitSec: 20,
  options: [
    { id: 'a', text: '4' },
    { id: 'b', text: '5' },
  ],
  correctOptionId: 'a',
};
const multiple: Question = {
  id: 'q2',
  type: 'multiple',
  prompt: 'Парні числа',
  timeLimitSec: 20,
  options: [
    { id: 'a', text: '2' },
    { id: 'b', text: '3' },
    { id: 'c', text: '4' },
  ],
  correctOptionIds: ['a', 'c'],
};
const text: Question = {
  id: 'q3',
  type: 'text',
  prompt: 'Слово',
  timeLimitSec: 20,
  acceptedAnswers: ["м'яч", 'мяч'],
};

describe('normalizeText', () => {
  it('ignores case, spacing and apostrophe variants', () => {
    expect(normalizeText('  М’ЯЧ  ')).toBe("м'яч");
    expect(normalizeText('мʼяч')).toBe("м'яч");
    expect(normalizeText('a   b')).toBe('a b');
  });
});

describe('isAnswerCorrect', () => {
  it('grades single choice', () => {
    expect(isAnswerCorrect(single, 'a')).toBe(true);
    expect(isAnswerCorrect(single, 'b')).toBe(false);
    expect(isAnswerCorrect(single, ['a'])).toBe(false);
    expect(isAnswerCorrect(single, undefined)).toBe(false);
  });

  it('requires the exact set for multiple choice', () => {
    expect(isAnswerCorrect(multiple, ['c', 'a'])).toBe(true);
    expect(isAnswerCorrect(multiple, ['a'])).toBe(false);
    expect(isAnswerCorrect(multiple, ['a', 'b', 'c'])).toBe(false);
    expect(isAnswerCorrect(multiple, 'a')).toBe(false);
  });

  it('accepts any listed text answer', () => {
    expect(isAnswerCorrect(text, 'М’яч')).toBe(true);
    expect(isAnswerCorrect(text, 'мяч ')).toBe(true);
    expect(isAnswerCorrect(text, 'м’ячик')).toBe(false);
    expect(isAnswerCorrect(text, '   ')).toBe(false);
  });
});

describe('gradeAnswers', () => {
  it('counts correct answers and treats missing ones as wrong', () => {
    const r = gradeAnswers([single, multiple, text], { q1: 'a', q3: 'мяч' });
    expect(r.correctCount).toBe(2);
    expect(r.total).toBe(3);
    expect(r.perQuestion.map((p) => p.correct)).toEqual([true, false, true]);
  });
});

describe('schemas', () => {
  it('rejects a correct option that is not among the options', () => {
    expect(questionSchema.safeParse({ ...single, correctOptionId: 'x' }).success).toBe(false);
    expect(questionSchema.safeParse({ ...multiple, correctOptionIds: ['a', 'z'] }).success).toBe(
      false,
    );
  });

  it('rejects duplicate question ids', () => {
    expect(quizInputSchema.safeParse({ title: 'T', questions: [single, single] }).success).toBe(
      false,
    );
  });

  it('fills the default time limit', () => {
    const { timeLimitSec, ...rest } = single;
    void timeLimitSec;
    const parsed = questionSchema.parse(rest);
    expect(parsed.timeLimitSec).toBe(30);
  });

  it('strips answers from public questions', () => {
    expect(toPublicQuestion(single)).not.toHaveProperty('correctOptionId');
    expect(toPublicQuestion(text)).not.toHaveProperty('acceptedAnswers');
  });
});
