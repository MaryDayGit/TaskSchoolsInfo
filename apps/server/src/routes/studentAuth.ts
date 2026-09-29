import { and, asc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { classCodeSchema, isJuniorGrade, studentLoginSchema } from '@infoklas/shared';
import type { ClassPublicDto, StudentMeDto } from '@infoklas/shared';
import { classes, students } from '../db/schema.js';
import { STUDENT_COOKIE, clearSession, setStudentSession } from '../auth.js';
import { HttpError, notFound } from '../lib/errors.js';
import { safeEqual } from '../lib/passwords.js';
import { loadStudent } from '../lib/studentContext.js';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MS = 60_000;

function normalizeSecret(kind: string, secret: string) {
  return kind === 'password' ? secret.trim().toLowerCase() : secret.trim();
}

export async function studentAuthRoutes(app: FastifyInstance) {
  const { db } = app;

  /** Class code → class name and the list of names to pick from. */
  app.get(
    '/api/join/:code',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (req): Promise<ClassPublicDto> => {
      const parsed = classCodeSchema.safeParse((req.params as { code?: string }).code);
      if (!parsed.success) throw notFound('Клас з таким кодом не знайдено');
      const [c] = await db.select().from(classes).where(eq(classes.joinCode, parsed.data));
      if (!c) throw notFound('Клас з таким кодом не знайдено');
      const list = await db
        .select({ id: students.id, displayName: students.displayName })
        .from(students)
        .where(eq(students.classId, c.id))
        .orderBy(asc(students.displayName));
      return { name: c.name, grade: c.grade, junior: isJuniorGrade(c.grade), students: list };
    },
  );

  app.post(
    '/api/student/login',
    { config: { rateLimit: { max: 300, timeWindow: '1 minute' } } },
    async (req, reply): Promise<StudentMeDto> => {
      const input = studentLoginSchema.parse(req.body);
      const [row] = await db
        .select({ s: students, c: classes })
        .from(students)
        .innerJoin(classes, eq(classes.id, students.classId))
        .where(and(eq(students.id, input.studentId), eq(classes.joinCode, input.classCode)));
      if (!row) throw new HttpError(401, 'Учня не знайдено. Перевір код класу.');
      const { s, c } = row;

      const now = new Date();
      if (s.lockedUntil && s.lockedUntil > now) {
        throw new HttpError(429, 'Забагато спроб. Зачекай хвилинку і спробуй ще раз.');
      }

      const ok = safeEqual(
        normalizeSecret(s.secretKind, input.secret),
        normalizeSecret(s.secretKind, s.secret),
      );
      if (!ok) {
        // Atomic increment, so parallel guesses can't bypass the lockout.
        const [upd] = await db
          .update(students)
          .set({ failedAttempts: sql`${students.failedAttempts} + 1` })
          .where(eq(students.id, s.id))
          .returning({ failed: students.failedAttempts });
        if ((upd?.failed ?? 0) >= MAX_FAILED_ATTEMPTS) {
          await db
            .update(students)
            .set({ failedAttempts: 0, lockedUntil: new Date(now.getTime() + LOCKOUT_MS) })
            .where(eq(students.id, s.id));
        }
        throw new HttpError(
          401,
          s.secretKind === 'pictures'
            ? 'Не ті картинки. Спробуй ще раз!'
            : 'Неправильний пароль. Спробуй ще раз!',
        );
      }

      if (s.failedAttempts > 0 || s.lockedUntil) {
        await db
          .update(students)
          .set({ failedAttempts: 0, lockedUntil: null })
          .where(eq(students.id, s.id));
      }
      setStudentSession(app, reply, s.id, c.id);
      return {
        id: s.id,
        displayName: s.displayName,
        classId: c.id,
        className: c.name,
        grade: c.grade,
        junior: isJuniorGrade(c.grade),
      };
    },
  );

  app.post('/api/student/logout', async (_req, reply) => {
    clearSession(app, reply, STUDENT_COOKIE);
    return { ok: true };
  });

  app.get('/api/student/me', async (req) => loadStudent(db, req));
}
