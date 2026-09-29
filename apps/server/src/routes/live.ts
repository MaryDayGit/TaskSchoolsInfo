import { desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { liveCreateSchema } from '@infoklas/shared';
import type { LiveSessionDto } from '@infoklas/shared';
import { liveSessions } from '../db/schema.js';
import { requireTeacher } from '../auth.js';
import { getOwnedClass } from '../lib/access.js';
import { idParam } from '../lib/params.js';

export async function liveRoutes(app: FastifyInstance) {
  const { db } = app;

  app.post('/api/live', async (req): Promise<LiveSessionDto> => {
    const teacherId = requireTeacher(req);
    const input = liveCreateSchema.parse(req.body);
    return app.live.create(teacherId, input.classId, input.quizId);
  });

  app.get('/api/classes/:id/live', async (req): Promise<LiveSessionDto[]> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const rows = await db
      .select()
      .from(liveSessions)
      .where(eq(liveSessions.classId, c.id))
      .orderBy(desc(liveSessions.createdAt))
      .limit(50);
    return rows.map((s) => ({
      id: s.id,
      classId: s.classId,
      title: s.title,
      status: s.status,
      createdAt: s.createdAt.toISOString(),
    }));
  });
}
