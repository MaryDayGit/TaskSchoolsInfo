import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from './lib/errors.js';

export const TEACHER_COOKIE = 'ik_teacher';
export const STUDENT_COOKIE = 'ik_student';
const SESSION_DAYS = 30;

export interface TeacherToken {
  role: 'teacher';
  sub: string;
}

export interface StudentToken {
  role: 'student';
  sub: string;
  cls: string;
}

function cookieOptions(app: FastifyInstance) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: app.config.env === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}

export function setTeacherSession(app: FastifyInstance, reply: FastifyReply, teacherId: string) {
  const token = app.jwt.sign({ role: 'teacher', sub: teacherId } satisfies TeacherToken, {
    expiresIn: `${SESSION_DAYS}d`,
  });
  reply.setCookie(TEACHER_COOKIE, token, cookieOptions(app));
}

export function setStudentSession(
  app: FastifyInstance,
  reply: FastifyReply,
  studentId: string,
  classId: string,
) {
  const token = app.jwt.sign(
    { role: 'student', sub: studentId, cls: classId } satisfies StudentToken,
    { expiresIn: `${SESSION_DAYS}d` },
  );
  reply.setCookie(STUDENT_COOKIE, token, cookieOptions(app));
}

export function clearSession(app: FastifyInstance, reply: FastifyReply, cookie: string) {
  reply.clearCookie(cookie, { ...cookieOptions(app), maxAge: undefined });
}

export function verifyTeacherToken(app: FastifyInstance, token: string | undefined): string | null {
  if (!token) return null;
  try {
    const payload = app.jwt.verify<TeacherToken>(token);
    return payload.role === 'teacher' ? payload.sub : null;
  } catch {
    return null;
  }
}

export function verifyStudentToken(
  app: FastifyInstance,
  token: string | undefined,
): StudentToken | null {
  if (!token) return null;
  try {
    const payload = app.jwt.verify<StudentToken>(token);
    return payload.role === 'student' ? payload : null;
  } catch {
    return null;
  }
}

/** Returns the authenticated teacher id or throws 401. */
export function requireTeacher(req: FastifyRequest): string {
  const id = verifyTeacherToken(req.server, req.cookies[TEACHER_COOKIE]);
  if (!id) throw new HttpError(401, 'Потрібно увійти');
  return id;
}

/** Returns the authenticated student token or throws 401. */
export function requireStudentToken(req: FastifyRequest): StudentToken {
  const t = verifyStudentToken(req.server, req.cookies[STUDENT_COOKIE]);
  if (!t) throw new HttpError(401, 'Потрібно увійти');
  return t;
}
