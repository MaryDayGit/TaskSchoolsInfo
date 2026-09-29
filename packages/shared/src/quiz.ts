import { z } from 'zod';

import { DEFAULT_TIME_LIMIT_SEC, MAX_QUESTIONS } from './grading.js';

export * from './grading.js';

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

/** A single answer: an option id, a list of option ids, or free text. */
export const answerValueSchema = z.union([z.string().max(500), z.array(z.string().max(40)).max(8)]);
export type AnswerValue = z.infer<typeof answerValueSchema>;

/** Answers keyed by question id. A missing key means the question was skipped. */
export const answerMapSchema = z.record(z.string().max(40), answerValueSchema);
export type AnswerMap = z.infer<typeof answerMapSchema>;
