import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ClassDto, QuizDto, StudentDto, AssignmentDto } from '@infoklas/shared';
import { liveResults, liveSessions } from '../../apps/server/src/db/schema';
import {
  Agent,
  createTestApp,
  registerTeacher,
  sampleQuestions,
} from '../../apps/server/src/test/helpers';
import { planInfoKlas, readInfoKlasRows, type InfoKlasRows } from './infoklas';
import { countWrites, type PlanWrite } from './plan';
import { seeded } from './test/fixtures';

// Настоящий сервер прежнего ІнфоКласа на PGlite: данные создаются его же API,
// поэтому строки таблиц точно такие, как в базе на Neon.
let ctx: Awaited<ReturnType<typeof createTestApp>>;
let rows: InfoKlasRows;
let junior: ClassDto;
let senior: ClassDto;
let pupils: StudentDto[];
let words: StudentDto[];
let hw: AssignmentDto;
let gameId: string;

beforeAll(async () => {
  ctx = await createTestApp();
  const t = await registerTeacher(ctx.app);
  junior = (await t.post('/api/classes', { name: '3-А', grade: 3 })).json();
  senior = (await t.post('/api/classes', { name: '8-Б', grade: 8 })).json();
  pupils = (await t.post(`/api/classes/${junior.id}/students`, { names: ['Оля', 'Петро'] })).json();
  words = (
    await t.post(`/api/classes/${senior.id}/students`, { names: ['Андрій', 'Богдана'] })
  ).json();
  const quiz: QuizDto = (
    await t.post('/api/quizzes', { title: 'Одиниці інформації', questions: sampleQuestions })
  ).json();
  hw = (
    await t.post('/api/assignments', {
      quizId: quiz.id,
      classId: senior.id,
      maxAttempts: 2,
      showCorrect: false,
      dueAt: '2026-10-01T18:00:00.000Z',
    })
  ).json();
  const s = new Agent(ctx.app);
  await s.post('/api/student/login', {
    classCode: senior.joinCode,
    studentId: words[0]!.id,
    secret: words[0]!.secret,
  });
  await s.post(`/api/student/assignments/${hw.id}/submit`, { answers: { q1: 'a' } });
  await s.post(`/api/student/assignments/${hw.id}/submit`, {
    answers: { q1: 'b', q2: ['a', 'c'], q3: 'біт' },
  });
  // A finished live game (the old server writes these rows at the end of a game).
  const [g] = await ctx.db
    .insert(liveSessions)
    .values({
      classId: senior.id,
      quizId: quiz.id,
      title: 'Бліц',
      questions: sampleQuestions,
      status: 'finished',
      endedAt: new Date('2026-09-20T09:00:00Z'),
    })
    .returning();
  gameId = g!.id;
  await ctx.db.insert(liveResults).values([
    {
      sessionId: gameId,
      studentId: words[0]!.id,
      score: 1700,
      correctCount: 2,
      total: 3,
      answers: {},
    },
    {
      sessionId: gameId,
      studentId: words[1]!.id,
      score: 900,
      correctCount: 1,
      total: 3,
      answers: {},
    },
  ]);
  await ctx.db.insert(liveSessions).values({
    classId: senior.id,
    title: 'Покинута',
    questions: sampleQuestions,
    status: 'aborted',
  });
  rows = await readInfoKlasRows(
    async (q) => (await ctx.db.execute(sql.raw(q))) as unknown as { rows: unknown[] },
  );
});

afterAll(async () => {
  await ctx?.close();
});

const find = (writes: PlanWrite[], path: string) => writes.find((w) => w.path === path)?.data;

describe('planInfoKlas (real rows of the old server)', () => {
  it('moves classes, pupils with working passwords, the bank, homework, submissions, games', () => {
    const plan = planInfoKlas(rows, [], { now: 1, random: seeded(3) });
    const c = countWrites(plan.writes);
    expect(c).toMatchObject({
      classes: 2,
      joinCodes: 2,
      'classes/*/roster': 4,
      studentSecrets: 4,
      quizzes: 1,
      assignments: 1,
      assignmentKeys: 1,
      submissions: 2,
      games: 1,
      gameKeys: 1,
      gameResults: 2,
    });
    expect(plan.notes.join('\n')).toContain('Не переносяться 1 незавершених ігор');

    // Same ids and class codes: old /join links keep working.
    expect(find(plan.writes, `classes/${junior.id}`)).toMatchObject({
      name: '3-А',
      grade: 3,
      joinCode: junior.joinCode,
    });
    expect(find(plan.writes, `joinCodes/${junior.joinCode}`)).toEqual({ classId: junior.id });

    // 3-picture passwords stay valid; words are compared in lower case, as before.
    expect(find(plan.writes, `classes/${junior.id}/roster/${pupils[0]!.id}`)).toMatchObject({
      displayName: 'Оля',
      secretKind: 'pictures',
      pictureCount: 3,
    });
    expect(find(plan.writes, `studentSecrets/${pupils[0]!.id}`)).toEqual({
      classId: junior.id,
      secret: pupils[0]!.secret,
    });
    expect(find(plan.writes, `studentSecrets/${words[0]!.id}`)).toEqual({
      classId: senior.id,
      secret: words[0]!.secret.toLowerCase(),
    });

    const a = find(plan.writes, `assignments/${hw.id}`)!;
    expect(a).toMatchObject({
      classId: senior.id,
      kind: 'homework',
      maxAttempts: 2,
      reveal: 'never',
      dueAt: { __ts: Date.parse('2026-10-01T18:00:00.000Z') },
      summary: { submitted: 1, avgPercent: 100 },
    });
    expect(JSON.stringify(a.questions)).not.toContain('correctOptionId');
    expect(find(plan.writes, `assignmentKeys/${hw.id}`)).toEqual({ questions: sampleQuestions });
    expect(find(plan.writes, `submissions/${hw.id}_${words[0]!.id}_2`)).toMatchObject({
      assignmentId: hw.id,
      classId: senior.id,
      studentId: words[0]!.id,
      attempt: 2,
      answers: { q1: 'b', q2: ['a', 'c'], q3: 'біт' },
    });

    expect(find(plan.writes, `games/${gameId}`)).toMatchObject({
      status: 'finished',
      active: false,
      index: 2,
      junior: false,
      leaderboard: [
        { name: 'Андрій', score: 1700 },
        { name: 'Богдана', score: 900 },
      ],
    });
    expect(find(plan.writes, `gameResults/${gameId}_${words[1]!.id}`)).toMatchObject({
      gameId,
      classId: senior.id,
      correctCount: 1,
      total: 3,
    });
  });

  it('a class code already taken gets a new one; a second run adds nothing', () => {
    const target = [{ path: `joinCodes/${senior.joinCode}` }];
    const plan = planInfoKlas(rows, target, { now: 1, random: seeded(4) });
    const code = find(plan.writes, `classes/${senior.id}`)!.joinCode as string;
    expect(code).not.toBe(senior.joinCode);
    expect(plan.warnings[0]).toContain(`код ${senior.joinCode} вже зайнятий`);
    const again = planInfoKlas(rows, [...target, ...plan.writes], { now: 1, random: seeded(4) });
    expect(again.writes).toEqual([]);
  });
});
