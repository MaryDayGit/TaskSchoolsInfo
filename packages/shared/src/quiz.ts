import { z } from 'zod';

export const MAX_QUESTIONS = 50;
export const DEFAULT_TIME_LIMIT_SEC = 30;

const idSchema = z.string().min(1).max(40);

export const optionSchema = z.object({
  id: idSchema,
  text: z.string().trim().min(1, 'Варіант відповіді не може бути порожнім').max(300),
});

const baseQuestion = {
  id: idSchema,
  prompt: z.string().trim().min(1, 'Напишіть текст питання').max(2000),
  /** Used in live mode only: how many seconds students have to answer. */
  timeLimitSec: z.number().int().min(5).max(600).default(DEFAULT_TIME_LIMIT_SEC),
};

const singleQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('single'),
  options: z.array(optionSchema).min(2).max(8),
  correctOptionId: idSchema,
});

const multipleQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('multiple'),
  options: z.array(optionSchema).min(2).max(8),
  correctOptionIds: z.array(idSchema).min(1).max(8),
});

const textQuestionSchema = z.object({
  ...baseQuestion,
  type: z.literal('text'),
  acceptedAnswers: z
    .array(z.string().trim().min(1).max(200))
    .min(1, 'Додайте хоча б одну правильну відповідь')
    .max(20),
});

export const questionSchema = z
  .discriminatedUnion('type', [singleQuestionSchema, multipleQuestionSchema, textQuestionSchema])
  .superRefine((q, ctx) => {
    if (q.type === 'text') return;
    const ids = q.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Варіанти мають повторювані id', path: ['options'] });
    }
    const correct = q.type === 'single' ? [q.correctOptionId] : q.correctOptionIds;
    if (!correct.every((id) => ids.includes(id))) {
      ctx.addIssue({
        code: 'custom',
        message: 'Позначте правильну відповідь серед варіантів',
        path: ['options'],
      });
    }
  });

export type Question = z.infer<typeof questionSchema>;
export type QuestionType = Question['type'];
export type QuizOption = z.infer<typeof optionSchema>;

export const questionListSchema = z
  .array(questionSchema)
  .max(MAX_QUESTIONS)
  .superRefine((qs, ctx) => {
    const ids = qs.map((q) => q.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: 'custom', message: 'Питання мають повторювані id' });
    }
  });

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

/** A single answer: an option id, a list of option ids, or free text. */
export const answerValueSchema = z.union([z.string().max(500), z.array(z.string().max(40)).max(8)]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

/** Answers keyed by question id. A missing key means the question was skipped. */
export const answerMapSchema = z.record(z.string().max(40), answerValueSchema);
export type AnswerMap = z.infer<typeof answerMapSchema>;

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
