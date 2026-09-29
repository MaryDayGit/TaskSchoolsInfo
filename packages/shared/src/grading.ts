/*
 * Question types and answer checking without zod, so the student page can grade
 * its own review without loading the schema library. `quiz.ts` re-exports all of it.
 */
import type { AnswerMap, AnswerValue, Question, QuizOption } from './quiz.js';

export type { AnswerMap, AnswerValue, Question, QuizOption };

export const MAX_QUESTIONS = 50;
export const DEFAULT_TIME_LIMIT_SEC = 30;

/** A question as students see it: everything except the correct answer. */
export type PublicQuestion =
  | { id: string; type: 'single'; prompt: string; timeLimitSec: number; options: QuizOption[] }
  | { id: string; type: 'multiple'; prompt: string; timeLimitSec: number; options: QuizOption[] }
  | { id: string; type: 'text'; prompt: string; timeLimitSec: number };

export function toPublicQuestion(q: Question): PublicQuestion {
  switch (q.type) {
    case 'single':
    case 'multiple':
      return {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        timeLimitSec: q.timeLimitSec,
        options: q.options,
      };
    case 'text':
      return { id: q.id, type: q.type, prompt: q.prompt, timeLimitSec: q.timeLimitSec };
  }
}

/**
 * Normalizes free-text answers so that trivial differences (case, extra spaces,
 * different apostrophe characters common in Ukrainian text) don't make a correct
 * answer wrong.
 */
export function normalizeText(s: string): string {
  return s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[’ʼ`´‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAnswerCorrect(q: Question, value: AnswerValue | undefined): boolean {
  if (value === undefined) return false;
  switch (q.type) {
    case 'single':
      return typeof value === 'string' && value === q.correctOptionId;
    case 'multiple': {
      if (!Array.isArray(value)) return false;
      const given = new Set(value);
      const expected = new Set(q.correctOptionIds);
      return given.size === expected.size && [...expected].every((id) => given.has(id));
    }
    case 'text': {
      if (typeof value !== 'string') return false;
      const n = normalizeText(value);
      return n.length > 0 && q.acceptedAnswers.some((a) => normalizeText(a) === n);
    }
  }
}

export interface GradedQuestion {
  questionId: string;
  correct: boolean;
}

export interface GradeResult {
  correctCount: number;
  total: number;
  perQuestion: GradedQuestion[];
}

export function gradeAnswers(questions: Question[], answers: AnswerMap): GradeResult {
  const perQuestion = questions.map((q) => ({
    questionId: q.id,
    correct: isAnswerCorrect(q, answers[q.id]),
  }));
  return {
    correctCount: perQuestion.filter((r) => r.correct).length,
    total: questions.length,
    perQuestion,
  };
}

/** Human-readable correct answer, used when showing results to students. */
export function describeCorrectAnswer(q: Question): string {
  switch (q.type) {
    case 'single':
      return q.options.find((o) => o.id === q.correctOptionId)?.text ?? '';
    case 'multiple':
      return q.options
        .filter((o) => q.correctOptionIds.includes(o.id))
        .map((o) => o.text)
        .join(', ');
    case 'text':
      return q.acceptedAnswers[0] ?? '';
  }
}
