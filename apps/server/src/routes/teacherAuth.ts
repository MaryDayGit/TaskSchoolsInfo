import { count, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { teacherLoginSchema, teacherRegisterSchema } from '@infoklas/shared';
import type { AuthConfigDto, TeacherDto } from '@infoklas/shared';
import { teachers } from '../db/schema.js';
import {
  TEACHER_COOKIE,
  clearSession,
  requireTeacher,
  setTeacherSession,
} from '../auth.js';
import { HttpError, conflict, forbidden } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/passwords.js';

const authRateLimit = { rateLimit: { max: 10, timeWindow: '1 minute' } };

// Used to spend comparable time when the email doesn't exist (no user enumeration by timing).
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

export async function teacherAuthRoutes(app: FastifyInstance) {
  const { db } = app;

  async function signupOpen() {
    if (app.config.teacherSignup) return true;
    const [row] = await db.select({ n: count() }).from(teachers);
    return (row?.n ?? 0) === 0;
  }

  app.get('/api/auth/config', async (): Promise<AuthConfigDto> => ({
    teacherSignupOpen: await signupOpen(),
  }));

  app.post('/api/auth/register', { config: authRateLimit }, async (req, reply) => {
    const input = teacherRegisterSchema.parse(req.body);
    if (!(await signupOpen())) throw forbidden('Реєстрацію вчителів закрито');
    const passwordHash = await hashPassword(input.password);
    const [row] = await db
      .insert(teachers)
      .values({ email: input.email, name: input.name, passwordHash })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict('Користувач з такою поштою вже існує');
    setTeacherSession(app, reply, row.id);
    return { id: row.id, email: row.email, name: row.name } satisfies TeacherDto;
  });

  app.post('/api/auth/login', { config: authRateLimit }, async (req, reply) => {
    const input = teacherLoginSchema.parse(req.body);
    const [row] = await db.select().from(teachers).where(eq(teachers.email, input.email));
    const ok = row
      ? await verifyPassword(input.password, row.passwordHash)
      : (await verifyPassword(input.password, await DUMMY_HASH), false);
    if (!row || !ok) throw new HttpError(401, 'Невірна пошта або пароль');
    setTeacherSession(app, reply, row.id);
    return { id: row.id, email: row.email, name: row.name } satisfies TeacherDto;
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSession(app, reply, TEACHER_COOKIE);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req): Promise<TeacherDto> => {
    const id = requireTeacher(req);
    const [row] = await db.select().from(teachers).where(eq(teachers.id, id));
    if (!row) throw new HttpError(401, 'Потрібно увійти');
    return { id: row.id, email: row.email, name: row.name };
  });
}
