import { z } from 'zod';
import { MAX_GRADE, MIN_GRADE } from './grades.js';
import { answerMapSchema, questionListSchema } from './quiz.js';
import type { PublicQuestion, Question, AnswerValue } from './quiz.js';

// ---------- Request schemas (validated on the server, reused by forms) ----------

export const teacherRegisterSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некоректна адреса пошти').max(200),
  name: z.string().trim().min(1, "Вкажіть ім'я").max(100),
  password: z.string().min(8, 'Пароль має містити щонайменше 8 символів').max(200),
});

export const teacherLoginSchema = z.object({
  email: z.string().trim().toLowerCase().max(200),
  password: z.string().max(200),
});

export const classInputSchema = z.object({
  name: z.string().trim().min(1, 'Вкажіть назву класу').max(40),
  grade: z.number().int().min(MIN_GRADE).max(MAX_GRADE),
});

export const addStudentsSchema = z.object({
  names: z.array(z.string().trim().min(1).max(60)).min(1, 'Додайте хоча б одного учня').max(60),
});

export const updateStudentSchema = z.object({
  displayName: z.string().trim().min(1).max(60),
});

export const classCodeSchema = z.string().regex(/^\d{6}$/, 'Код класу — це 6 цифр');

export const studentLoginSchema = z.object({
  classCode: classCodeSchema,
  studentId: z.string().uuid(),
  secret: z.string().min(1).max(100),
});

export const quizInputSchema = z.object({
  title: z.string().trim().min(1, 'Вкажіть назву').max(200),
  questions: questionListSchema,
});

export const assignmentInputSchema = z.object({
  quizId: z.string().uuid(),
  classId: z.string().uuid(),
  dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  /** null = unlimited attempts */
  maxAttempts: z.number().int().min(1).max(20).nullable().default(null),
  showCorrect: z.boolean().default(true),
});

export const submitAnswersSchema = z.object({
  answers: answerMapSchema,
});

export const liveCreateSchema = z.object({
  quizId: z.string().uuid(),
  classId: z.string().uuid(),
});

export type TeacherRegisterInput = z.infer<typeof teacherRegisterSchema>;
export type ClassInput = z.infer<typeof classInputSchema>;
export type QuizInput = z.infer<typeof quizInputSchema>;
export type AssignmentInput = z.input<typeof assignmentInputSchema>;

// ---------- Response DTOs ----------

export interface ApiError {
  error: string;
  details?: unknown;
}

export interface TeacherDto {
  id: string;
  email: string;
  name: string;
}

export interface AuthConfigDto {
  teacherSignupOpen: boolean;
}

export interface ClassDto {
  id: string;
  name: string;
  grade: number;
  joinCode: string;
  studentCount: number;
  createdAt: string;
}

export type SecretKind = 'pictures' | 'password';

/** Teacher's view of a student, including the login secret for printing cards. */
export interface StudentDto {
  id: string;
  displayName: string;
  secretKind: SecretKind;
  secret: string;
}

export interface ClassPublicDto {
  name: string;
  grade: number;
  junior: boolean;
  students: { id: string; displayName: string }[];
}

export interface StudentMeDto {
  id: string;
  displayName: string;
  classId: string;
  className: string;
  grade: number;
  junior: boolean;
}

export interface QuizSummaryDto {
  id: string;
  title: string;
  questionCount: number;
  updatedAt: string;
}

export interface QuizDto {
  id: string;
  title: string;
  questions: Question[];
  updatedAt: string;
}

export interface AssignmentDto {
  id: string;
  classId: string;
  title: string;
  questionCount: number;
  dueAt: string | null;
  maxAttempts: number | null;
  showCorrect: boolean;
  createdAt: string;
  submittedCount: number;
}

export interface ScoreDto {
  correctCount: number;
  total: number;
}

export interface StudentAssignmentSummaryDto {
  id: string;
  title: string;
  questionCount: number;
  dueAt: string | null;
  maxAttempts: number | null;
  attemptsUsed: number;
  best: ScoreDto | null;
  closed: boolean;
}

export interface StudentAssignmentDto extends StudentAssignmentSummaryDto {
  questions: PublicQuestion[];
}

export interface QuestionFeedbackDto {
  questionId: string;
  correct: boolean;
  given: AnswerValue | null;
  /** Only present when the teacher allowed showing correct answers. */
  correctAnswer?: string;
}

export interface SubmissionResultDto extends ScoreDto {
  attempt: number;
  perQuestion: QuestionFeedbackDto[];
}

export interface AssignmentResultRowDto {
  studentId: string;
  displayName: string;
  attempts: number;
  best: (ScoreDto & { submittedAt: string }) | null;
  /** Per-question correctness of the best attempt, in question order. */
  perQuestion: boolean[] | null;
}

export interface AssignmentResultsDto {
  assignment: AssignmentDto;
  questions: Question[];
  rows: AssignmentResultRowDto[];
}

export interface JournalColumnDto {
  id: string;
  kind: 'assignment' | 'live';
  title: string;
  date: string;
}

export interface JournalDto {
  students: { id: string; displayName: string }[];
  columns: JournalColumnDto[];
  /** Keyed by `${studentId}:${columnId}`. */
  cells: Record<string, ScoreDto>;
}

export type LiveSessionStatus = 'active' | 'finished' | 'aborted';

export interface LiveSessionDto {
  id: string;
  classId: string;
  title: string;
  status: LiveSessionStatus;
  createdAt: string;
}
