import { eq } from 'drizzle-orm';
import type { FastifyRequest } from 'fastify';
import { isJuniorGrade } from '@infoklas/shared';
import type { StudentMeDto } from '@infoklas/shared';
import type { Db } from '../db/client.js';
import { classes, students } from '../db/schema.js';
import { requireStudentToken } from '../auth.js';
import { HttpError } from './errors.js';

/**
 * Resolves the logged-in student from the cookie and checks they still exist in the
 * same class (the teacher may have removed them since the token was issued).
 */
export async function loadStudent(db: Db, req: FastifyRequest): Promise<StudentMeDto> {
  const token = requireStudentToken(req);
  return loadStudentById(db, token.sub, token.cls);
}

export async function loadStudentById(
  db: Db,
  studentId: string,
  classId: string,
): Promise<StudentMeDto> {
  const [row] = await db
    .select({ s: students, c: classes })
    .from(students)
    .innerJoin(classes, eq(classes.id, students.classId))
    .where(eq(students.id, studentId));
  if (!row || row.c.id !== classId) throw new HttpError(401, 'Потрібно увійти');
  return {
    id: row.s.id,
    displayName: row.s.displayName,
    classId: row.c.id,
    className: row.c.name,
    grade: row.c.grade,
    junior: isJuniorGrade(row.c.grade),
  };
}
