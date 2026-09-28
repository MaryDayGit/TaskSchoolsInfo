import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  AssignmentDto,
  AssignmentResultsDto,
  ClassDto,
  ClassPublicDto,
  JournalDto,
  QuizDto,
  StudentAssignmentDto,
  StudentAssignmentSummaryDto,
  StudentDto,
  SubmissionResultDto,
} from '@infoklas/shared';
import { students } from '../db/schema.js';
import { Agent, createTestApp, registerTeacher, sampleQuestions } from './helpers.js';

type Ctx = Awaited<ReturnType<typeof createTestApp>>;
let ctx: Ctx;

afterEach(async () => {
  await ctx.close();
});

describe('teacher auth', () => {
  beforeEach(async () => {
    ctx = await createTestApp({ teacherSignup: false });
  });

  it('lets only the first teacher register when sign-up is closed', async () => {
    const a = new Agent(ctx.app);
    expect((await a.get('/api/auth/config')).json()).toEqual({ teacherSignupOpen: true });
    const first = await a.post('/api/auth/register', {
      email: 'Teacher@School.ua',
      name: 'Олена',
      password: 'password-123',
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ email: 'teacher@school.ua', name: 'Олена' });

    const b = new Agent(ctx.app);
    expect((await b.get('/api/auth/config')).json()).toEqual({ teacherSignupOpen: false });
    const second = await b.post('/api/auth/register', {
      email: 'other@school.ua',
      name: 'Інший',
      password: 'password-123',
    });
    expect(second.statusCode).toBe(403);
  });

  it('logs in, reports me, and logs out', async () => {
    const a = new Agent(ctx.app);
    await a.post('/api/auth/register', { email: 't@s.ua', name: 'Т', password: 'password-123' });
    await a.post('/api/auth/logout');
    expect((await a.get('/api/auth/me')).statusCode).toBe(401);

    expect((await a.post('/api/auth/login', { email: 't@s.ua', password: 'wrong-pass' })).statusCode).toBe(401);
    expect((await a.post('/api/auth/login', { email: 'nobody@s.ua', password: 'x' })).statusCode).toBe(401);
    const ok = await a.post('/api/auth/login', { email: 'T@S.ua', password: 'password-123' });
    expect(ok.statusCode).toBe(200);
    expect((await a.get('/api/auth/me')).json()).toMatchObject({ email: 't@s.ua' });
  });

  it('rejects short passwords with a Ukrainian message', async () => {
    const a = new Agent(ctx.app);
    const res = await a.post('/api/auth/register', { email: 't@s.ua', name: 'Т', password: '123' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toContain('8 символів');
  });
});

describe('classes and students', () => {
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  it('creates classes with 6-digit codes and generates secrets by grade', async () => {
    const t = await registerTeacher(ctx.app);
    const junior: ClassDto = (await t.post('/api/classes', { name: '2-А', grade: 2 })).json();
    const senior: ClassDto = (await t.post('/api/classes', { name: '7-Б', grade: 7 })).json();
    expect(junior.joinCode).toMatch(/^\d{6}$/);

    const j: StudentDto[] = (
      await t.post(`/api/classes/${junior.id}/students`, { names: ['Оля К.', 'Петро', 'Оля К.'] })
    ).json();
    expect(j).toHaveLength(2);
    expect(j[0]!.secretKind).toBe('pictures');
    expect(j[0]!.secret).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);

    const s: StudentDto[] = (await t.post(`/api/classes/${senior.id}/students`, { names: ['Іван'] })).json();
    expect(s[0]!.secretKind).toBe('password');
    expect(s[0]!.secret).toMatch(/^\p{L}+\d{2}$/u);

    const dup = await t.post(`/api/classes/${junior.id}/students`, { names: ['Петро'] });
    expect(dup.statusCode).toBe(409);

    const list: ClassDto[] = (await t.get('/api/classes')).json();
    expect(list.map((c) => [c.name, c.studentCount])).toEqual([
      ['2-А', 2],
      ['7-Б', 1],
    ]);
  });

  it("hides other teachers' classes", async () => {
    const t1 = await registerTeacher(ctx.app);
    const t2 = await registerTeacher(ctx.app);
    const c: ClassDto = (await t1.post('/api/classes', { name: '5-А', grade: 5 })).json();
    expect((await t2.get(`/api/classes/${c.id}`)).statusCode).toBe(404);
    expect((await t2.get(`/api/classes/${c.id}/students`)).statusCode).toBe(404);
    expect((await t2.delete(`/api/classes/${c.id}`)).statusCode).toBe(404);
    expect((await t2.get('/api/classes')).json()).toEqual([]);
    expect((await t2.get('/api/classes/not-a-uuid')).statusCode).toBe(404);
    expect((await new Agent(ctx.app).get('/api/classes')).statusCode).toBe(401);
  });

  it('resets a student secret', async () => {
    const t = await registerTeacher(ctx.app);
    const c: ClassDto = (await t.post('/api/classes', { name: '6-А', grade: 6 })).json();
    const [st]: StudentDto[] = (await t.post(`/api/classes/${c.id}/students`, { names: ['Марко'] })).json();
    const reset: StudentDto = (await t.post(`/api/students/${st!.id}/reset-secret`)).json();
    expect(reset.secretKind).toBe('password');
    expect(reset.id).toBe(st!.id);
  });
});

describe('student login', () => {
  let t: Agent;
  let cls: ClassDto;
  let student: StudentDto;

  beforeEach(async () => {
    ctx = await createTestApp();
    t = await registerTeacher(ctx.app);
    cls = (await t.post('/api/classes', { name: '3-В', grade: 3 })).json();
    [student] = (await t.post(`/api/classes/${cls.id}/students`, { names: ['Софія'] })).json();
  });

  it('shows the class by code', async () => {
    const s = new Agent(ctx.app);
    const info: ClassPublicDto = (await s.get(`/api/join/${cls.joinCode}`)).json();
    expect(info).toEqual({
      name: '3-В',
      grade: 3,
      junior: true,
      students: [{ id: student.id, displayName: 'Софія' }],
    });
    expect((await s.get('/api/join/000000')).statusCode).toBe(404);
    expect((await s.get('/api/join/abc')).statusCode).toBe(404);
  });

  it('logs in with the right pictures and locks after 5 failures', async () => {
    const s = new Agent(ctx.app);
    const wrong = student.secret === 'cat-cat-cat' ? 'dog-dog-dog' : 'cat-cat-cat';
    const body = (secret: string) => ({ classCode: cls.joinCode, studentId: student.id, secret });

    for (let i = 0; i < 5; i++) {
      expect((await s.post('/api/student/login', body(wrong))).statusCode).toBe(401);
    }
    const locked = await s.post('/api/student/login', body(student.secret));
    expect(locked.statusCode).toBe(429);

    await ctx.db.update(students).set({ lockedUntil: null }).where(eq(students.id, student.id));
    const ok = await s.post('/api/student/login', body(student.secret));
    expect(ok.statusCode).toBe(200);
    expect((await s.get('/api/student/me')).json()).toMatchObject({
      displayName: 'Софія',
      junior: true,
      className: '3-В',
    });
    // Student session doesn't grant teacher access.
    expect((await s.get('/api/classes')).statusCode).toBe(401);
  });

  it('rejects login with a wrong class code', async () => {
    const s = new Agent(ctx.app);
    const res = await s.post('/api/student/login', {
      classCode: cls.joinCode === '111111' ? '222222' : '111111',
      studentId: student.id,
      secret: student.secret,
    });
    expect(res.statusCode).toBe(401);
  });

  it('invalidates the session when the student is removed', async () => {
    const s = new Agent(ctx.app);
    await s.post('/api/student/login', {
      classCode: cls.joinCode,
      studentId: student.id,
      secret: student.secret,
    });
    await t.delete(`/api/students/${student.id}`);
    expect((await s.get('/api/student/me')).statusCode).toBe(401);
  });
});

describe('quizzes, assignments and the journal', () => {
  beforeEach(async () => {
    ctx = await createTestApp();
  });

  async function setup(assignment: Partial<{ maxAttempts: number | null; dueAt: string | null; showCorrect: boolean }> = {}) {
    const t = await registerTeacher(ctx.app);
    const cls: ClassDto = (await t.post('/api/classes', { name: '8-А', grade: 8 })).json();
    const [st]: StudentDto[] = (await t.post(`/api/classes/${cls.id}/students`, { names: ['Андрій', 'Богдана'] })).json();
    const quiz: QuizDto = (await t.post('/api/quizzes', { title: 'Одиниці інформації', questions: sampleQuestions })).json();
    const res = await t.post('/api/assignments', { quizId: quiz.id, classId: cls.id, ...assignment });
    expect(res.statusCode).toBe(200);
    const a: AssignmentDto = res.json();
    const s = new Agent(ctx.app);
    await s.post('/api/student/login', { classCode: cls.joinCode, studentId: st!.id, secret: st!.secret });
    return { t, s, cls, quiz, a, student: st! };
  }

  it('validates quiz questions', async () => {
    const t = await registerTeacher(ctx.app);
    const bad = await t.post('/api/quizzes', {
      title: 'X',
      questions: [{ ...sampleQuestions[0], correctOptionId: 'zzz' }],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toContain('правильну відповідь');
  });

  it('hides answers from students and grades submissions', async () => {
    const { s, t, a } = await setup({ maxAttempts: 2 });

    const list: StudentAssignmentSummaryDto[] = (await s.get('/api/student/assignments')).json();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ title: 'Одиниці інформації', attemptsUsed: 0, closed: false });

    const detail: StudentAssignmentDto = (await s.get(`/api/student/assignments/${a.id}`)).json();
    const raw = JSON.stringify(detail.questions);
    expect(raw).not.toContain('correct');
    expect(raw).not.toContain('acceptedAnswers');

    const r1: SubmissionResultDto = (
      await s.post(`/api/student/assignments/${a.id}/submit`, {
        answers: { q1: 'b', q2: ['c', 'a'], q3: '  БІТ ', unknown: 'x' },
      })
    ).json();
    expect(r1).toMatchObject({ attempt: 1, correctCount: 3, total: 3 });
    expect(r1.perQuestion[0]).toMatchObject({ correct: true, correctAnswer: '8' });

    const r2: SubmissionResultDto = (
      await s.post(`/api/student/assignments/${a.id}/submit`, { answers: { q1: 'a' } })
    ).json();
    expect(r2).toMatchObject({ attempt: 2, correctCount: 0 });

    const r3 = await s.post(`/api/student/assignments/${a.id}/submit`, { answers: {} });
    expect(r3.statusCode).toBe(409);

    const last: SubmissionResultDto = (await s.get(`/api/student/assignments/${a.id}/result`)).json();
    expect(last.attempt).toBe(2);

    const results: AssignmentResultsDto = (await t.get(`/api/assignments/${a.id}/results`)).json();
    expect(results.assignment.submittedCount).toBe(1);
    const andriy = results.rows.find((r) => r.displayName === 'Андрій')!;
    expect(andriy).toMatchObject({ attempts: 2, best: { correctCount: 3, total: 3 }, perQuestion: [true, true, true] });
    expect(results.rows.find((r) => r.displayName === 'Богдана')).toMatchObject({ attempts: 0, best: null });
  });

  it('hides correct answers when the teacher turns it off', async () => {
    const { s, a } = await setup({ showCorrect: false });
    const r: SubmissionResultDto = (
      await s.post(`/api/student/assignments/${a.id}/submit`, { answers: { q1: 'a' } })
    ).json();
    expect(r.perQuestion[0]).not.toHaveProperty('correctAnswer');
  });

  it('closes assignments after the due date', async () => {
    const { s, a } = await setup({ dueAt: new Date(Date.now() - 60_000).toISOString() });
    const res = await s.post(`/api/student/assignments/${a.id}/submit`, { answers: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('минув');
  });

  it("doesn't let students see other classes' assignments", async () => {
    const { a } = await setup();
    const other = await setup();
    expect((await other.s.get(`/api/student/assignments/${a.id}`)).statusCode).toBe(404);
  });

  it('keeps the assignment snapshot when the quiz is edited later', async () => {
    const { t, s, a, quiz } = await setup();
    await t.put(`/api/quizzes/${quiz.id}`, { title: 'Змінено', questions: [sampleQuestions[0]] });
    const detail: StudentAssignmentDto = (await s.get(`/api/student/assignments/${a.id}`)).json();
    expect(detail.title).toBe('Одиниці інформації');
    expect(detail.questions).toHaveLength(3);
  });

  it('builds the journal and exports CSV', async () => {
    const { t, s, cls, a, student } = await setup();
    await s.post(`/api/student/assignments/${a.id}/submit`, { answers: { q1: 'b' } });
    const j: JournalDto = (await t.get(`/api/classes/${cls.id}/journal`)).json();
    expect(j.students.map((x) => x.displayName)).toEqual(['Андрій', 'Богдана']);
    expect(j.columns).toEqual([expect.objectContaining({ id: a.id, kind: 'assignment' })]);
    expect(j.cells[`${student.id}:${a.id}`]).toEqual({ correctCount: 1, total: 3 });

    const csv = await t.get(`/api/classes/${cls.id}/journal.csv`);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('Учень;Одиниці інформації');
    expect(csv.body).toContain('Андрій;33%');
  });
});
