import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import type {
  ClassDto,
  ClientToServerEvents,
  JournalDto,
  LiveAck,
  LiveHostState,
  LivePlayerState,
  LiveSessionDto,
  LiveState,
  QuizDto,
  ServerToClientEvents,
  StudentDto,
} from '@infoklas/shared';
import { attachLiveSocket } from '../live/socket.js';
import { Agent, createTestApp, registerTeacher, sampleQuestions } from './helpers.js';

type Client = Socket<ServerToClientEvents, ClientToServerEvents>;

let ctx: Awaited<ReturnType<typeof createTestApp>>;
let url: string;
const sockets: Client[] = [];

beforeEach(async () => {
  ctx = await createTestApp();
  attachLiveSocket(ctx.app, ctx.app.server);
  await ctx.app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(ctx.app.server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  for (const s of sockets.splice(0)) s.disconnect();
  await ctx.close();
});

/** A socket that remembers the latest state it received. */
function client(agent: Agent) {
  const socket: Client = connect(url, {
    transports: ['websocket'],
    extraHeaders: { cookie: agent.cookieHeader },
    forceNew: true,
  });
  sockets.push(socket);
  let latest: LiveState | null = null;
  const waiters: { pred: (s: LiveState) => boolean; resolve: (s: LiveState) => void }[] = [];
  socket.on('live:state', (s) => {
    latest = s;
    for (const w of waiters.splice(0)) {
      if (w.pred(s)) w.resolve(s);
      else waiters.push(w);
    }
  });
  return {
    socket,
    emit: <E extends keyof ClientToServerEvents>(event: E, payload: Parameters<ClientToServerEvents[E]>[0]) =>
      new Promise<LiveAck>((resolve) =>
        (socket.emit as (e: string, p: unknown, ack: (r: LiveAck) => void) => void)(event, payload, resolve),
      ),
    waitFor<T extends LiveState>(pred: (s: T) => boolean): Promise<T> {
      if (latest && pred(latest as T)) return Promise.resolve(latest as T);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout; latest=${JSON.stringify(latest)}`)), 5000);
        waiters.push({
          pred: pred as (s: LiveState) => boolean,
          resolve: (s) => {
            clearTimeout(timer);
            resolve(s as T);
          },
        });
      });
    },
  };
}

async function setup(grade: number) {
  const teacher = await registerTeacher(ctx.app);
  const cls: ClassDto = (await teacher.post('/api/classes', { name: `${grade}-А`, grade })).json();
  const studs: StudentDto[] = (
    await teacher.post(`/api/classes/${cls.id}/students`, { names: ['Аня', 'Борис'] })
  ).json();
  const quiz: QuizDto = (
    await teacher.post('/api/quizzes', { title: 'Бліц', questions: sampleQuestions })
  ).json();
  const session: LiveSessionDto = (
    await teacher.post('/api/live', { quizId: quiz.id, classId: cls.id })
  ).json();
  const players = await Promise.all(
    studs.map(async (st) => {
      const a = new Agent(ctx.app);
      await a.post('/api/student/login', { classCode: cls.joinCode, studentId: st.id, secret: st.secret });
      return a;
    }),
  );
  return { teacher, cls, studs, session, players };
}

describe('live quiz over websockets', () => {
  it('runs a full game and saves results to the journal', async () => {
    const { teacher, cls, session, players, studs } = await setup(7);
    const sessionId = session.id;

    // The class sees the active game.
    expect((await players[0]!.get('/api/student/live')).json()).toEqual({ id: sessionId, title: 'Бліц' });

    const host = client(teacher);
    expect(await host.emit('live:host', { sessionId })).toEqual({ ok: true });

    const [anya, borys] = players.map(client);
    expect(await anya!.emit('live:join', { sessionId })).toEqual({ ok: true });
    expect(await borys!.emit('live:join', { sessionId })).toEqual({ ok: true });
    await host.waitFor<LiveHostState>((s) => s.participants.filter((p) => p.connected).length === 2);

    // Students can't control the game.
    expect((await anya!.emit('live:start', { sessionId })).ok).toBe(false);

    await host.emit('live:start', { sessionId });
    const q1 = await anya!.waitFor<LivePlayerState>((s) => s.status === 'question');
    expect(q1.question?.prompt).toBe('Скільки бітів у байті?');
    expect(JSON.stringify(q1.question)).not.toContain('correct');

    expect((await anya!.emit('live:answer', { sessionId, questionIndex: 0, value: 'b' })).ok).toBe(true);
    // Double answers are rejected.
    expect((await anya!.emit('live:answer', { sessionId, questionIndex: 0, value: 'a' })).ok).toBe(false);
    await borys!.emit('live:answer', { sessionId, questionIndex: 0, value: 'a' });

    // Everyone answered → revealed automatically.
    const hostReveal = await host.waitFor<LiveHostState>((s) => s.status === 'reveal');
    expect(hostReveal.optionStats).toEqual([
      { optionId: 'a', count: 1 },
      { optionId: 'b', count: 1 },
    ]);
    const anyaReveal = await anya!.waitFor<LivePlayerState>((s) => s.status === 'reveal');
    expect(anyaReveal.myResult).toMatchObject({ correct: true, correctAnswer: '8' });
    expect(anyaReveal.myResult!.points).toBeGreaterThan(500);
    expect(anyaReveal.myPlace).toBe(1);
    expect(anyaReveal.leaderboard[0]!.name).toBe('Аня');

    await host.emit('live:next', { sessionId });
    await anya!.waitFor((s) => s.status === 'question' && s.questionIndex === 1);
    await anya!.emit('live:answer', { sessionId, questionIndex: 1, value: ['a', 'c'] });
    // Borys doesn't answer; teacher reveals manually.
    expect(await host.emit('live:reveal', { sessionId })).toEqual({ ok: true });
    await host.emit('live:next', { sessionId });
    await host.waitFor((s) => s.questionIndex === 2);
    await borys!.emit('live:answer', { sessionId, questionIndex: 2, value: 'Біт' });
    await anya!.emit('live:answer', { sessionId, questionIndex: 2, value: 'байт' });
    const textReveal = await host.waitFor<LiveHostState>((s) => s.status === 'reveal' && s.questionIndex === 2);
    expect(textReveal.textAnswers).toHaveLength(2);

    await host.emit('live:next', { sessionId });
    const final = await anya!.waitFor<LivePlayerState>((s) => s.status === 'finished');
    expect(final.myCorrectCount).toBe(2);

    // Results are persisted asynchronously right after finishing.
    await expect
      .poll(async () => ((await teacher.get(`/api/classes/${cls.id}/journal`)).json() as JournalDto).columns.length)
      .toBe(1);
    const journal: JournalDto = (await teacher.get(`/api/classes/${cls.id}/journal`)).json();
    expect(journal.cells[`${studs[0]!.id}:${sessionId}`]).toEqual({ correctCount: 2, total: 3 });
    expect(journal.cells[`${studs[1]!.id}:${sessionId}`]).toEqual({ correctCount: 1, total: 3 });
    expect((await players[0]!.get('/api/student/live')).json()).toBeNull();
  });

  it('hides the leaderboard and speed bonus in primary school', async () => {
    const { teacher, session, players } = await setup(3);
    const sessionId = session.id;
    const host = client(teacher);
    await host.emit('live:host', { sessionId });
    const p = client(players[0]!);
    await p.emit('live:join', { sessionId });
    await host.emit('live:start', { sessionId });
    await p.emit('live:answer', { sessionId, questionIndex: 0, value: 'b' });
    const reveal = await p.waitFor<LivePlayerState>((s) => s.status === 'reveal');
    expect(reveal.junior).toBe(true);
    expect(reveal.leaderboard).toEqual([]);
    expect(reveal.myPlace).toBeNull();
    expect(reveal.myResult?.points).toBe(100);
  });

  it("rejects other teachers and students from other classes", async () => {
    const { session } = await setup(6);
    const other = await setup(6);
    const intruderHost = client(other.teacher);
    expect((await intruderHost.emit('live:host', { sessionId: session.id })).ok).toBe(false);
    const intruder = client(other.players[0]!);
    expect((await intruder.emit('live:join', { sessionId: session.id })).ok).toBe(false);
    const anonymous = client(new Agent(ctx.app));
    expect((await anonymous.emit('live:join', { sessionId: session.id })).ok).toBe(false);
  });
});
