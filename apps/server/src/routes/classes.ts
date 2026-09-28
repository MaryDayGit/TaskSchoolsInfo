import { and, asc, count, eq, inArray, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { addStudentsSchema, classInputSchema, updateStudentSchema } from '@infoklas/shared';
import type { ClassDto, JournalDto, StudentDto } from '@infoklas/shared';
import type { Db } from '../db/client.js';
import {
  assignments,
  classes,
  liveResults,
  liveSessions,
  students,
  submissions,
} from '../db/schema.js';
import { requireTeacher } from '../auth.js';
import { getOwnedClass, getOwnedStudent } from '../lib/access.js';
import { generateJoinCode, generateStudentSecret } from '../lib/codes.js';
import { conflict } from '../lib/errors.js';
import { idParam } from '../lib/params.js';

type ClassRow = typeof classes.$inferSelect;
type StudentRow = typeof students.$inferSelect;

function toClassDto(c: ClassRow, studentCount: number): ClassDto {
  return {
    id: c.id,
    name: c.name,
    grade: c.grade,
    joinCode: c.joinCode,
    studentCount,
    createdAt: c.createdAt.toISOString(),
  };
}

function toStudentDto(s: StudentRow): StudentDto {
  return { id: s.id, displayName: s.displayName, secretKind: s.secretKind, secret: s.secret };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e.code === '23505' || e.cause?.code === '23505';
}

/** Retries on the (rare) join code collision. */
async function withUniqueJoinCode<T>(fn: (code: string) => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn(generateJoinCode());
    } catch (err) {
      if (!isUniqueViolation(err) || i >= 10) throw err;
    }
  }
}

async function countStudents(db: Db, classId: string) {
  const [row] = await db.select({ n: count() }).from(students).where(eq(students.classId, classId));
  return row?.n ?? 0;
}

export async function buildJournal(db: Db, classId: string): Promise<JournalDto> {
  const studentRows = await db
    .select({ id: students.id, displayName: students.displayName })
    .from(students)
    .where(eq(students.classId, classId))
    .orderBy(asc(students.displayName));

  const assignmentRows = await db
    .select({ id: assignments.id, title: assignments.title, createdAt: assignments.createdAt })
    .from(assignments)
    .where(eq(assignments.classId, classId));

  const liveRows = await db
    .select({ id: liveSessions.id, title: liveSessions.title, createdAt: liveSessions.createdAt })
    .from(liveSessions)
    .where(and(eq(liveSessions.classId, classId), eq(liveSessions.status, 'finished')));

  const columns: JournalDto['columns'] = [
    ...assignmentRows.map((a) => ({
      id: a.id,
      kind: 'assignment' as const,
      title: a.title,
      date: a.createdAt.toISOString(),
    })),
    ...liveRows.map((l) => ({
      id: l.id,
      kind: 'live' as const,
      title: l.title,
      date: l.createdAt.toISOString(),
    })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  const cells: JournalDto['cells'] = {};

  if (assignmentRows.length > 0) {
    // Best attempt per student per assignment (every attempt has the same total).
    const best = await db
      .select({
        assignmentId: submissions.assignmentId,
        studentId: submissions.studentId,
        correctCount: max(submissions.correctCount),
        total: max(submissions.total),
      })
      .from(submissions)
      .where(
        inArray(
          submissions.assignmentId,
          assignmentRows.map((a) => a.id),
        ),
      )
      .groupBy(submissions.assignmentId, submissions.studentId);
    for (const b of best) {
      cells[`${b.studentId}:${b.assignmentId}`] = {
        correctCount: b.correctCount ?? 0,
        total: b.total ?? 0,
      };
    }
  }

  if (liveRows.length > 0) {
    const results = await db
      .select()
      .from(liveResults)
      .where(
        inArray(
          liveResults.sessionId,
          liveRows.map((l) => l.id),
        ),
      );
    for (const r of results) {
      cells[`${r.studentId}:${r.sessionId}`] = { correctCount: r.correctCount, total: r.total };
    }
  }

  return { students: studentRows, columns, cells };
}

function csvCell(v: string): string {
  // Also neutralize spreadsheet formula injection.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function journalToCsv(j: JournalDto): string {
  const header = ['Учень', ...j.columns.map((c) => c.title)];
  const lines = [header.map(csvCell).join(';')];
  for (const s of j.students) {
    const row = [s.displayName];
    for (const c of j.columns) {
      const cell = j.cells[`${s.id}:${c.id}`];
      row.push(
        cell && cell.total > 0 ? `${Math.round((100 * cell.correctCount) / cell.total)}%` : '',
      );
    }
    lines.push(row.map(csvCell).join(';'));
  }
  // BOM so that Excel opens the UTF-8 file with Cyrillic correctly.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

export async function classRoutes(app: FastifyInstance) {
  const { db } = app;

  app.get('/api/classes', async (req): Promise<ClassDto[]> => {
    const teacherId = requireTeacher(req);
    const rows = await db
      .select({ c: classes, n: count(students.id) })
      .from(classes)
      .leftJoin(students, eq(students.classId, classes.id))
      .where(eq(classes.teacherId, teacherId))
      .groupBy(classes.id)
      .orderBy(asc(classes.grade), asc(classes.name));
    return rows.map((r) => toClassDto(r.c, r.n));
  });

  app.post('/api/classes', async (req): Promise<ClassDto> => {
    const teacherId = requireTeacher(req);
    const input = classInputSchema.parse(req.body);
    const row = await withUniqueJoinCode(async (joinCode) => {
      const [created] = await db
        .insert(classes)
        .values({ teacherId, name: input.name, grade: input.grade, joinCode })
        .returning();
      return created!;
    });
    return toClassDto(row, 0);
  });

  app.get('/api/classes/:id', async (req): Promise<ClassDto> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    return toClassDto(c, await countStudents(db, c.id));
  });

  app.patch('/api/classes/:id', async (req): Promise<ClassDto> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const input = classInputSchema.parse(req.body);
    const [updated] = await db
      .update(classes)
      .set({ name: input.name, grade: input.grade })
      .where(eq(classes.id, c.id))
      .returning();
    return toClassDto(updated!, await countStudents(db, c.id));
  });

  app.delete('/api/classes/:id', async (req) => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    app.live.abortForClass(c.id);
    await db.delete(classes).where(eq(classes.id, c.id));
    return { ok: true };
  });

  app.post('/api/classes/:id/regenerate-code', async (req): Promise<ClassDto> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const updated = await withUniqueJoinCode(async (joinCode) => {
      const [row] = await db
        .update(classes)
        .set({ joinCode })
        .where(eq(classes.id, c.id))
        .returning();
      return row!;
    });
    return toClassDto(updated, await countStudents(db, c.id));
  });

  // ---------- Students ----------

  app.get('/api/classes/:id/students', async (req): Promise<StudentDto[]> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const rows = await db
      .select()
      .from(students)
      .where(eq(students.classId, c.id))
      .orderBy(asc(students.displayName));
    return rows.map(toStudentDto);
  });

  app.post('/api/classes/:id/students', async (req): Promise<StudentDto[]> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const { names } = addStudentsSchema.parse(req.body);
    const unique = [...new Set(names)];

    const existing = await db
      .select({ displayName: students.displayName })
      .from(students)
      .where(and(eq(students.classId, c.id), inArray(students.displayName, unique)));
    if (existing.length > 0) {
      throw conflict(
        `У класі вже є: ${existing.map((e) => e.displayName).join(', ')}. Змініть імена (наприклад, додайте першу літеру прізвища).`,
      );
    }
    const [{ n } = { n: 0 }] = await db
      .select({ n: count() })
      .from(students)
      .where(eq(students.classId, c.id));
    if (n + unique.length > 60) throw conflict('У класі може бути не більше 60 учнів');

    const rows = await db
      .insert(students)
      .values(
        unique.map((displayName) => {
          const { kind, secret } = generateStudentSecret(c.grade);
          return { classId: c.id, displayName, secretKind: kind, secret };
        }),
      )
      .returning();
    return rows.map(toStudentDto);
  });

  app.patch('/api/students/:id', async (req): Promise<StudentDto> => {
    const teacherId = requireTeacher(req);
    const { student } = await getOwnedStudent(db, teacherId, idParam(req.params));
    const { displayName } = updateStudentSchema.parse(req.body);
    try {
      const [row] = await db
        .update(students)
        .set({ displayName })
        .where(eq(students.id, student.id))
        .returning();
      return toStudentDto(row!);
    } catch (err) {
      if (isUniqueViolation(err)) throw conflict('У класі вже є учень з таким іменем');
      throw err;
    }
  });

  /** New login secret (e.g. a forgotten password or after changing the class grade). */
  app.post('/api/students/:id/reset-secret', async (req): Promise<StudentDto> => {
    const teacherId = requireTeacher(req);
    const { student, grade } = await getOwnedStudent(db, teacherId, idParam(req.params));
    const { kind, secret } = generateStudentSecret(grade);
    const [row] = await db
      .update(students)
      .set({ secretKind: kind, secret, failedAttempts: 0, lockedUntil: null })
      .where(eq(students.id, student.id))
      .returning();
    return toStudentDto(row!);
  });

  app.delete('/api/students/:id', async (req) => {
    const teacherId = requireTeacher(req);
    const { student } = await getOwnedStudent(db, teacherId, idParam(req.params));
    await db.delete(students).where(eq(students.id, student.id));
    return { ok: true };
  });

  // ---------- Journal ----------

  app.get('/api/classes/:id/journal', async (req): Promise<JournalDto> => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    return buildJournal(db, c.id);
  });

  app.get('/api/classes/:id/journal.csv', async (req, reply) => {
    const teacherId = requireTeacher(req);
    const c = await getOwnedClass(db, teacherId, idParam(req.params));
    const csv = journalToCsv(await buildJournal(db, c.id));
    const filename = encodeURIComponent(`Журнал ${c.name}.csv`);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename*=UTF-8''${filename}`)
      .send(csv);
  });
}
