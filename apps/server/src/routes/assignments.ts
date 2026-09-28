import { asc, countDistinct, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { assignmentInputSchema, gradeAnswers } from '@infoklas/shared';
import type {
  AssignmentDto,
  AssignmentResultRowDto,
  AssignmentResultsDto,
} from '@infoklas/shared';
import type { Db } from '../db/client.js';
import { assignments, students, submissions } from '../db/schema.js';
import { requireTeacher } from '../auth.js';
import { getOwnedAssignment, getOwnedClass, getOwnedQuiz } from '../lib/access.js';
import { badRequest } from '../lib/errors.js';
import { idParam } from '../lib/params.js';

type AssignmentRow = typeof assignments.$inferSelect;

export function toAssignmentDto(a: AssignmentRow, submittedCount: number): AssignmentDto {
  return {
    id: a.id,
    classId: a.classId,
    title: a.title,
    questionCount: a.questions.length,
    dueAt: a.dueAt?.toISOString() ?? null,
    maxAttempts: a.maxAttempts,
    showCorrect: a.showCorrect,
    createdAt: a.createdAt.toISOString(),
    submittedCount,
  };
}

async function submittedStudents(db: Db, assignmentId: string) {
  const [row] = await db
    .select({ n: countDistinct(submissions.studentId) })
    .from(submissions)
    .where(eq(submissions.assignmentId, assignmentId));
  return row?.n ?? 0;
}

const assignmentPatchSchema = z.object({
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(20).nullable().optional(),
  showCorrect: z.boolean().optional(),
});

export async function assignmentRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/classes/:id/assignments', async (req): Promise<AssignmentDto[]> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const rows = await db
      .select({ a: assignments, n: countDistinct(submissions.studentId) })
      .from(assignments)
      .leftJoin(submissions, eq(submissions.assignmentId, assignments.id))
      .where(eq(assignments.classId, c.id))
      .groupBy(assignments.id)
      .orderBy(desc(assignments.createdAt));
    return rows.map((r) => toAssignmentDto(r.a, r.n));
  });

  app.post('/api/assignments', async (req): Promise<AssignmentDto> => {
    const teacherId = requireTeacher(req);
    const input = assignmentInputSchema.parse(req.body);
    const c = await getOwnedClass(db, teacherId, input.classId);
    const quiz = await getOwnedQuiz(db, teacherId, input.quizId);
    if (quiz.questions.length === 0) throw badRequest('У тесті немає жодного питання');
    const [row] = await db
      .insert(assignments)
      .values({
        classId: c.id,
        quizId: quiz.id,
        title: quiz.title,
        questions: quiz.questions,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
        maxAttempts: input.maxAttempts,
        showCorrect: input.showCorrect,
      })
      .returning();
    return toAssignmentDto(row!, 0);
  });

  app.patch('/api/assignments/:id', async (req): Promise<AssignmentDto> => {
    const teacherId = requireTeacher(req);
    const a = await getOwnedAssignment(db, teacherId, idParam(req.params));
    const input = assignmentPatchSchema.parse(req.body);
    const [row] = await db
      .update(assignments)
      .set({
        ...(input.dueAt !== undefined && { dueAt: input.dueAt ? new Date(input.dueAt) : null }),
        ...(input.maxAttempts !== undefined && { maxAttempts: input.maxAttempts }),
        ...(input.showCorrect !== undefined && { showCorrect: input.showCorrect }),
      })
      .where(eq(assignments.id, a.id))
      .returning();
    return toAssignmentDto(row!, await submittedStudents(db, a.id));
  });

  app.delete('/api/assignments/:id', async (req) => {
    const teacherId = requireTeacher(req);
    const a = await getOwnedAssignment(db, teacherId, idParam(req.params));
    await db.delete(assignments).where(eq(assignments.id, a.id));
    return { ok: true };
  });

  app.get('/api/assignments/:id/results', async (req): Promise<AssignmentResultsDto> => {
    const teacherId = requireTeacher(req);
    const a = await getOwnedAssignment(db, teacherId, idParam(req.params));

    const classStudents = await db
      .select({ id: students.id, displayName: students.displayName })
      .from(students)
      .where(eq(students.classId, a.classId))
      .orderBy(asc(students.displayName));

    const subs = await db
      .select()
      .from(submissions)
      .where(eq(submissions.assignmentId, a.id))
      .orderBy(asc(submissions.attempt));

    const rows: AssignmentResultRowDto[] = classStudents.map((s) => {
      const mine = subs.filter((x) => x.studentId === s.id);
      // Best attempt; on ties the latest one.
      const best = mine.reduce<(typeof mine)[number] | null>(
        (acc, x) => (!acc || x.correctCount >= acc.correctCount ? x : acc),
        null,
      );
      return {
        studentId: s.id,
        displayName: s.displayName,
        attempts: mine.length,
        best: best
          ? {
              correctCount: best.correctCount,
              total: best.total,
              submittedAt: best.submittedAt.toISOString(),
            }
          : null,
        perQuestion: best
          ? gradeAnswers(a.questions, best.answers).perQuestion.map((p) => p.correct)
          : null,
      };
    });

    const submittedCount = rows.filter((r) => r.attempts > 0).length;
    return { assignment: toAssignmentDto(a, submittedCount), questions: a.questions, rows };
  });
}
