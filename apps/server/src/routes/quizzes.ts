import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { quizInputSchema } from '@infoklas/shared';
import type { QuizDto, QuizSummaryDto } from '@infoklas/shared';
import { quizzes } from '../db/schema.js';
import { requireTeacher } from '../auth.js';
import { getOwnedQuiz } from '../lib/access.js';
import { idParam } from '../lib/params.js';

type QuizRow = typeof quizzes.$inferSelect;

function toQuizDto(q: QuizRow): QuizDto {
  return { id: q.id, title: q.title, questions: q.questions, updatedAt: q.updatedAt.toISOString() };
}

export async function quizRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/quizzes', async (req): Promise<QuizSummaryDto[]> => {
    const teacherId = requireTeacher(req);
    const rows = await db
      .select()
      .from(quizzes)
      .where(eq(quizzes.teacherId, teacherId))
      .orderBy(desc(quizzes.updatedAt));
    return rows.map((q) => ({
      id: q.id,
      title: q.title,
      questionCount: q.questions.length,
      updatedAt: q.updatedAt.toISOString(),
    }));
  });

  app.post('/api/quizzes', async (req): Promise<QuizDto> => {
    const teacherId = requireTeacher(req);
    const input = quizInputSchema.parse(req.body);
    const [row] = await db
      .insert(quizzes)
      .values({ teacherId, title: input.title, questions: input.questions })
      .returning();
    return toQuizDto(row!);
  });

  app.get('/api/quizzes/:id', async (req): Promise<QuizDto> => {
    const teacherId = requireTeacher(req);
    return toQuizDto(await getOwnedQuiz(db, teacherId, idParam(req.params)));
  });

  app.put('/api/quizzes/:id', async (req): Promise<QuizDto> => {
    const teacherId = requireTeacher(req);
    const quiz = await getOwnedQuiz(db, teacherId, idParam(req.params));
    const input = quizInputSchema.parse(req.body);
    const [row] = await db
      .update(quizzes)
      .set({ title: input.title, questions: input.questions, updatedAt: new Date() })
      .where(eq(quizzes.id, quiz.id))
      .returning();
    return toQuizDto(row!);
  });

  app.post('/api/quizzes/:id/duplicate', async (req): Promise<QuizDto> => {
    const teacherId = requireTeacher(req);
    const quiz = await getOwnedQuiz(db, teacherId, idParam(req.params));
    const [row] = await db
      .insert(quizzes)
      .values({ teacherId, title: `${quiz.title} (копія)`, questions: quiz.questions })
      .returning();
    return toQuizDto(row!);
  });

  app.delete('/api/quizzes/:id', async (req) => {
    const teacherId = requireTeacher(req);
    const quiz = await getOwnedQuiz(db, teacherId, idParam(req.params));
    await db.delete(quizzes).where(eq(quizzes.id, quiz.id));
    return { ok: true };
  });
}
