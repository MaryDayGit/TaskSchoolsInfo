import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import type { AnswerMap, LiveSessionStatus, Question, SecretKind } from '@infoklas/shared';

const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const teachers = pgTable('teachers', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: createdAt(),
});

export const classes = pgTable(
  'classes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    grade: smallint('grade').notNull(),
    joinCode: text('join_code').notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [index('classes_teacher_idx').on(t.teacherId)],
);

export const students = pgTable(
  'students',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    secretKind: text('secret_kind').$type<SecretKind>().notNull(),
    /**
     * Teacher-issued login secret (picture sequence or simple word password). It is
     * stored retrievably on purpose so the teacher can reprint login cards; it is
     * never chosen by the child, so it can't leak a password reused elsewhere.
     */
    secret: text('secret').notNull(),
    failedAttempts: integer('failed_attempts').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [unique('students_class_name_uq').on(t.classId, t.displayName)],
);

export const quizzes = pgTable(
  'quizzes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    teacherId: uuid('teacher_id')
      .notNull()
      .references(() => teachers.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    questions: jsonb('questions').$type<Question[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('quizzes_teacher_idx').on(t.teacherId)],
);

export const assignments = pgTable(
  'assignments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Snapshot of the quiz at assignment time, so later edits don't change results. */
    questions: jsonb('questions').$type<Question[]>().notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }),
    maxAttempts: integer('max_attempts'),
    showCorrect: boolean('show_correct').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index('assignments_class_idx').on(t.classId)],
);

export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assignmentId: uuid('assignment_id')
      .notNull()
      .references(() => assignments.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    attempt: integer('attempt').notNull(),
    answers: jsonb('answers').$type<AnswerMap>().notNull(),
    correctCount: integer('correct_count').notNull(),
    total: integer('total').notNull(),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('submissions_attempt_uq').on(t.assignmentId, t.studentId, t.attempt)],
);

export const liveSessions = pgTable(
  'live_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'cascade' }),
    quizId: uuid('quiz_id').references(() => quizzes.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    questions: jsonb('questions').$type<Question[]>().notNull(),
    status: text('status').$type<LiveSessionStatus>().notNull().default('active'),
    createdAt: createdAt(),
    endedAt: timestamp('ended_at', { withTimezone: true }),
  },
  (t) => [index('live_sessions_class_idx').on(t.classId)],
);

export const liveResults = pgTable(
  'live_results',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => liveSessions.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    correctCount: integer('correct_count').notNull(),
    total: integer('total').notNull(),
    answers: jsonb('answers').$type<AnswerMap>().notNull(),
  },
  (t) => [unique('live_results_uq').on(t.sessionId, t.studentId)],
);
