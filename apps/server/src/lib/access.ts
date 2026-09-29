import { and, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { assignments, classes, quizzes, students } from '../db/schema.js';
import { notFound } from './errors.js';

// Every lookup is scoped by teacher id: a teacher can't even learn whether another
// teacher's resource exists (404 either way).

export async function getOwnedClass(db: Db, teacherId: string, classId: string) {
  const [row] = await db
    .select()
    .from(classes)
    .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId)));
  if (!row) throw notFound('Клас не знайдено');
  return row;
}

export async function getOwnedQuiz(db: Db, teacherId: string, quizId: string) {
  const [row] = await db
    .select()
    .from(quizzes)
    .where(and(eq(quizzes.id, quizId), eq(quizzes.teacherId, teacherId)));
  if (!row) throw notFound('Тест не знайдено');
  return row;
}

export async function getOwnedStudent(db: Db, teacherId: string, studentId: string) {
  const [row] = await db
    .select({ student: students, grade: classes.grade })
    .from(students)
    .innerJoin(classes, eq(classes.id, students.classId))
    .where(and(eq(students.id, studentId), eq(classes.teacherId, teacherId)));
  if (!row) throw notFound('Учня не знайдено');
  return row;
}

export async function getOwnedAssignment(db: Db, teacherId: string, assignmentId: string) {
  const [row] = await db
    .select({ assignment: assignments })
    .from(assignments)
    .innerJoin(classes, eq(classes.id, assignments.classId))
    .where(and(eq(assignments.id, assignmentId), eq(classes.teacherId, teacherId)));
  if (!row) throw notFound('Завдання не знайдено');
  return row.assignment;
}
