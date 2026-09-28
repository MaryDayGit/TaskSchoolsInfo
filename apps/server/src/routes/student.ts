import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import {
  describeCorrectAnswer,
  gradeAnswers,
  submitAnswersSchema,
  toPublicQuestion,
} from '@infoklas/shared';
import type {
  StudentAssignmentDto,
  StudentAssignmentSummaryDto,
  SubmissionResultDto,
} from '@infoklas/shared';
import type { Db } from '../db/client.js';
import { assignments, submissions } from '../db/schema.js';
import { conflict, notFound } from '../lib/errors.js';
import { idParam } from '../lib/params.js';
import { loadStudent } from '../lib/studentContext.js';

type AssignmentRow = typeof assignments.$inferSelect;
type SubmissionRow = typeof submissions.$inferSelect;

function summarize(
  a: AssignmentRow,
  mine: SubmissionRow[],
  now: Date,
): StudentAssignmentSummaryDto {
  const best = mine.reduce<SubmissionRow | null>(
    (acc, s) => (!acc || s.correctCount > acc.correctCount ? s : acc),
    null,
  );
  const attemptsLeft = a.maxAttempts === null || mine.length < a.maxAttempts;
  const beforeDue = a.dueAt === null || a.dueAt > now;
  return {
    id: a.id,
    title: a.title,
    questionCount: a.questions.length,
    dueAt: a.dueAt?.toISOString() ?? null,
    maxAttempts: a.maxAttempts,
    attemptsUsed: mine.length,
    best: best ? { correctCount: best.correctCount, total: best.total } : null,
    closed: !(attemptsLeft && beforeDue),
  };
}

function toResult(a: AssignmentRow, s: SubmissionRow): SubmissionResultDto {
  const graded = gradeAnswers(a.questions, s.answers);
  return {
    attempt: s.attempt,
    correctCount: graded.correctCount,
    total: graded.total,
    perQuestion: a.questions.map((q, i) => ({
      questionId: q.id,
      correct: graded.perQuestion[i]!.correct,
      given: s.answers[q.id] ?? null,
      ...(a.showCorrect && { correctAnswer: describeCorrectAnswer(q) }),
    })),
  };
}

async function getClassAssignment(db: Db, classId: string, assignmentId: string) {
  const [a] = await db
    .select()
    .from(assignments)
    .where(and(eq(assignments.id, assignmentId), eq(assignments.classId, classId)));
  if (!a) throw notFound('Завдання не знайдено');
  return a;
}

async function mySubmissions(db: Db, assignmentId: string, studentId: string) {
  return db
    .select()
    .from(submissions)
    .where(and(eq(submissions.assignmentId, assignmentId), eq(submissions.studentId, studentId)))
    .orderBy(desc(submissions.attempt));
}

export async function studentRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/student/assignments', async (req): Promise<StudentAssignmentSummaryDto[]> => {
    const me = await loadStudent(db, req);
    const rows = await db
      .select()
      .from(assignments)
      .where(eq(assignments.classId, me.classId))
      .orderBy(desc(assignments.createdAt));
    const subs = await db.select().from(submissions).where(eq(submissions.studentId, me.id));
    const now = new Date();
    return rows.map((a) =>
      summarize(
        a,
        subs.filter((s) => s.assignmentId === a.id),
        now,
      ),
    );
  });

  app.get('/api/student/assignments/:id', async (req): Promise<StudentAssignmentDto> => {
    const me = await loadStudent(db, req);
    const a = await getClassAssignment(db, me.classId, idParam(req.params));
    const mine = await mySubmissions(db, a.id, me.id);
    return { ...summarize(a, mine, new Date()), questions: a.questions.map(toPublicQuestion) };
  });

  app.get(
    '/api/student/assignments/:id/result',
    async (req): Promise<SubmissionResultDto | null> => {
      const me = await loadStudent(db, req);
      const a = await getClassAssignment(db, me.classId, idParam(req.params));
      const [last] = await mySubmissions(db, a.id, me.id);
      return last ? toResult(a, last) : null;
    },
  );

  app.post('/api/student/assignments/:id/submit', async (req): Promise<SubmissionResultDto> => {
    const me = await loadStudent(db, req);
    const a = await getClassAssignment(db, me.classId, idParam(req.params));
    const { answers } = submitAnswersSchema.parse(req.body);

    const mine = await mySubmissions(db, a.id, me.id);
    const summary = summarize(a, mine, new Date());
    if (summary.closed) {
      throw conflict(
        a.dueAt && a.dueAt <= new Date()
          ? 'Час на виконання завдання вже минув'
          : 'Усі спроби вже використано',
      );
    }

    // Keep only answers to questions that exist in this assignment.
    const known = new Set(a.questions.map((q) => q.id));
    const cleaned = Object.fromEntries(Object.entries(answers).filter(([k]) => known.has(k)));
    const graded = gradeAnswers(a.questions, cleaned);

    try {
      const [row] = await db
        .insert(submissions)
        .values({
          assignmentId: a.id,
          studentId: me.id,
          attempt: mine.length + 1,
          answers: cleaned,
          correctCount: graded.correctCount,
          total: graded.total,
        })
        .returning();
      return toResult(a, row!);
    } catch (err) {
      const e = err as { code?: string; cause?: { code?: string } };
      if (e.code === '23505' || e.cause?.code === '23505') {
        throw conflict('Відповіді вже надіслано');
      }
      throw err;
    }
  });

  app.get('/api/student/live', async (req) => {
    const me = await loadStudent(db, req);
    return app.live.activeForClass(me.classId);
  });
}
