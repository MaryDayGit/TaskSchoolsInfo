import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyBaseLogger } from 'fastify';
import {
  answerValueSchema,
  describeCorrectAnswer,
  isAnswerCorrect,
  isJuniorGrade,
  toPublicQuestion,
} from '@infoklas/shared';
import type {
  AnswerMap,
  AnswerValue,
  LiveHostState,
  LiveLeaderboardEntry,
  LivePlayerState,
  LiveSessionDto,
  LiveStatus,
  Question,
} from '@infoklas/shared';
import type { Db } from '../db/client.js';
import { classes, liveResults, liveSessions, quizzes } from '../db/schema.js';
import { badRequest, notFound } from '../lib/errors.js';

/** Late answers within this window are still accepted (network latency). */
const ANSWER_GRACE_MS = 1500;
/** Unfinished sessions without any activity are closed automatically. */
const IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000;
/** Finished sessions stay in memory for a while so clients can see the final screen. */
const FINISHED_TTL_MS = 30 * 60 * 1000;
const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const LEADERBOARD_SIZE = 5;

interface RecordedAnswer {
  value: AnswerValue;
  correct: boolean;
  points: number;
}

interface Participant {
  studentId: string;
  name: string;
  connections: number;
  score: number;
  /** Answers by question index. */
  answers: Map<number, RecordedAnswer>;
}

interface Room {
  id: string;
  teacherId: string;
  classId: string;
  className: string;
  joinCode: string;
  title: string;
  questions: Question[];
  junior: boolean;
  status: LiveStatus;
  questionIndex: number;
  questionStartedAt: number | null;
  deadline: number | null;
  participants: Map<string, Participant>;
  timer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  finishedAt: number | null;
}

export type LiveNotifier = (sessionId: string) => void;

export class LiveManager {
  private rooms = new Map<string, Room>();
  private notifier: LiveNotifier = () => {};
  private sweeper: ReturnType<typeof setInterval>;

  constructor(
    private readonly db: Db,
    private readonly log: FastifyBaseLogger,
  ) {
    this.sweeper = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweeper.unref?.();
  }

  setNotifier(fn: LiveNotifier) {
    this.notifier = fn;
  }

  /** Sessions left "active" by a previous process can't be resumed. */
  async abortStaleSessions() {
    await this.db
      .update(liveSessions)
      .set({ status: 'aborted', endedAt: new Date() })
      .where(eq(liveSessions.status, 'active'));
  }

  // ---------- Lifecycle (teacher) ----------

  async create(teacherId: string, classId: string, quizId: string): Promise<LiveSessionDto> {
    const [cls] = await this.db
      .select()
      .from(classes)
      .where(and(eq(classes.id, classId), eq(classes.teacherId, teacherId)));
    if (!cls) throw notFound('Клас не знайдено');
    const [quiz] = await this.db
      .select()
      .from(quizzes)
      .where(and(eq(quizzes.id, quizId), eq(quizzes.teacherId, teacherId)));
    if (!quiz) throw notFound('Тест не знайдено');
    if (quiz.questions.length === 0) throw badRequest('У тесті немає жодного питання');

    // One live session per class at a time: close the previous one properly.
    for (const room of this.rooms.values()) {
      if (room.classId === classId && room.status !== 'finished') await this.finish(room);
    }

    const [row] = await this.db
      .insert(liveSessions)
      .values({ classId, quizId, title: quiz.title, questions: quiz.questions })
      .returning();
    const s = row!;
    this.rooms.set(s.id, {
      id: s.id,
      teacherId,
      classId,
      className: cls.name,
      joinCode: cls.joinCode,
      title: s.title,
      questions: s.questions,
      junior: isJuniorGrade(cls.grade),
      status: 'lobby',
      questionIndex: -1,
      questionStartedAt: null,
      deadline: null,
      participants: new Map(),
      timer: null,
      lastActivity: Date.now(),
      finishedAt: null,
    });
    return {
      id: s.id,
      classId,
      title: s.title,
      status: 'active',
      createdAt: s.createdAt.toISOString(),
    };
  }

  private hostRoom(teacherId: string, sessionId: string): Room {
    const room = this.rooms.get(sessionId);
    if (!room || room.teacherId !== teacherId) throw notFound('Гру не знайдено');
    room.lastActivity = Date.now();
    return room;
  }

  assertHost(teacherId: string, sessionId: string) {
    this.hostRoom(teacherId, sessionId);
  }

  start(teacherId: string, sessionId: string) {
    const room = this.hostRoom(teacherId, sessionId);
    if (room.status !== 'lobby') throw badRequest('Гру вже розпочато');
    this.openQuestion(room, 0);
  }

  reveal(teacherId: string, sessionId: string) {
    const room = this.hostRoom(teacherId, sessionId);
    if (room.status !== 'question') throw badRequest('Зараз немає відкритого питання');
    this.closeQuestion(room);
  }

  async next(teacherId: string, sessionId: string) {
    const room = this.hostRoom(teacherId, sessionId);
    if (room.status === 'question') this.closeQuestion(room);
    if (room.status !== 'reveal') throw badRequest('Спочатку покажіть відповідь');
    if (room.questionIndex + 1 >= room.questions.length) {
      await this.finish(room);
    } else {
      this.openQuestion(room, room.questionIndex + 1);
    }
  }

  async end(teacherId: string, sessionId: string) {
    const room = this.hostRoom(teacherId, sessionId);
    if (room.status !== 'finished') await this.finish(room);
  }

  // ---------- Players ----------

  /** Registers a student in the room (joining mid-game is allowed). */
  joinPlayer(studentId: string, name: string, classId: string, sessionId: string) {
    const room = this.rooms.get(sessionId);
    if (!room || room.classId !== classId) throw notFound('Гру не знайдено');
    if (!room.participants.has(studentId)) {
      if (room.status === 'finished') throw badRequest('Гру вже завершено');
      room.participants.set(studentId, {
        studentId,
        name,
        connections: 0,
        score: 0,
        answers: new Map(),
      });
    }
    this.notify(room);
  }

  setConnected(sessionId: string, studentId: string, delta: 1 | -1) {
    const room = this.rooms.get(sessionId);
    const p = room?.participants.get(studentId);
    if (!room || !p) return;
    p.connections = Math.max(0, p.connections + delta);
    this.notify(room);
  }

  answer(studentId: string, sessionId: string, questionIndex: number, raw: unknown) {
    const room = this.rooms.get(sessionId);
    const p = room?.participants.get(studentId);
    if (!room || !p) throw notFound('Гру не знайдено');
    const value = answerValueSchema.parse(raw);
    if (room.status !== 'question' || questionIndex !== room.questionIndex) {
      throw badRequest('Час на це питання минув');
    }
    const now = Date.now();
    if (room.deadline !== null && now > room.deadline + ANSWER_GRACE_MS) {
      throw badRequest('Час на це питання минув');
    }
    if (p.answers.has(questionIndex)) throw badRequest('Відповідь уже зараховано');

    const q = room.questions[questionIndex]!;
    const correct = isAnswerCorrect(q, value);
    const points = correct ? this.pointsFor(room, q, now) : 0;
    p.answers.set(questionIndex, { value, correct, points });
    p.score += points;
    room.lastActivity = now;

    const connected = [...room.participants.values()].filter((x) => x.connections > 0);
    if (connected.length > 0 && connected.every((x) => x.answers.has(questionIndex))) {
      this.closeQuestion(room);
    } else {
      this.notify(room);
    }
  }

  private pointsFor(room: Room, q: Question, now: number): number {
    // Primary school: no speed pressure, every correct answer is worth the same.
    if (room.junior || room.questionStartedAt === null) return 100;
    const limit = q.timeLimitSec * 1000;
    const remaining = Math.max(0, Math.min(1, 1 - (now - room.questionStartedAt) / limit));
    return 500 + Math.round(500 * remaining);
  }

  // ---------- State transitions ----------

  private openQuestion(room: Room, index: number) {
    const q = room.questions[index]!;
    room.status = 'question';
    room.questionIndex = index;
    room.questionStartedAt = Date.now();
    room.deadline = room.questionStartedAt + q.timeLimitSec * 1000;
    this.clearTimer(room);
    room.timer = setTimeout(() => {
      room.timer = null;
      if (room.status === 'question' && room.questionIndex === index) this.closeQuestion(room);
    }, q.timeLimitSec * 1000);
    this.notify(room);
  }

  private closeQuestion(room: Room) {
    this.clearTimer(room);
    room.status = 'reveal';
    room.deadline = null;
    this.notify(room);
  }

  private async finish(room: Room) {
    this.clearTimer(room);
    room.status = 'finished';
    room.deadline = null;
    room.finishedAt = Date.now();
    this.notify(room);
    try {
      await this.persist(room);
    } catch (err) {
      this.log.error({ err, sessionId: room.id }, 'failed to persist live results');
    }
  }

  private async persist(room: Room) {
    // Only questions that were actually asked count (the teacher may end early).
    const total = Math.max(0, room.questionIndex + 1);
    if (total === 0) {
      // Ended before the first question: nothing to put in the journal.
      await this.db
        .update(liveSessions)
        .set({ status: 'aborted', endedAt: new Date() })
        .where(eq(liveSessions.id, room.id));
      return;
    }
    const rows = [...room.participants.values()].map((p) => {
      const answers: AnswerMap = {};
      let correctCount = 0;
      for (const [i, a] of p.answers) {
        answers[room.questions[i]!.id] = a.value;
        if (a.correct) correctCount++;
      }
      return {
        sessionId: room.id,
        studentId: p.studentId,
        score: p.score,
        correctCount,
        total,
        answers,
      };
    });
    await this.db.transaction(async (tx) => {
      if (rows.length > 0) {
        await tx.delete(liveResults).where(
          and(
            eq(liveResults.sessionId, room.id),
            inArray(
              liveResults.studentId,
              rows.map((r) => r.studentId),
            ),
          ),
        );
        await tx.insert(liveResults).values(rows);
      }
      await tx
        .update(liveSessions)
        .set({ status: 'finished', endedAt: new Date() })
        .where(eq(liveSessions.id, room.id));
    });
  }

  private clearTimer(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
  }

  private notify(room: Room) {
    try {
      this.notifier(room.id);
    } catch (err) {
      this.log.error({ err }, 'live notifier failed');
    }
  }

  // ---------- Queries ----------

  activeForClass(classId: string): { id: string; title: string } | null {
    for (const room of this.rooms.values()) {
      if (room.classId === classId && room.status !== 'finished') {
        return { id: room.id, title: room.title };
      }
    }
    return null;
  }

  /** Called when a class is deleted: its sessions disappear with it (DB cascade). */
  abortForClass(classId: string) {
    for (const room of [...this.rooms.values()]) {
      if (room.classId === classId) {
        this.clearTimer(room);
        this.rooms.delete(room.id);
      }
    }
  }

  playerIds(sessionId: string): string[] {
    return [...(this.rooms.get(sessionId)?.participants.keys() ?? [])];
  }

  private leaderboard(room: Room): LiveLeaderboardEntry[] {
    return this.ranked(room)
      .slice(0, LEADERBOARD_SIZE)
      .map((p) => ({ name: p.name, score: p.score }));
  }

  private ranked(room: Room): Participant[] {
    return [...room.participants.values()].sort(
      (a, b) => b.score - a.score || a.name.localeCompare(b.name, 'uk'),
    );
  }

  hostState(sessionId: string): LiveHostState | null {
    const room = this.rooms.get(sessionId);
    if (!room) return null;
    const q = room.questions[room.questionIndex] ?? null;
    const idx = room.questionIndex;
    const participants = [...room.participants.values()];
    const revealed = room.status === 'reveal';

    const optionStats: LiveHostState['optionStats'] = [];
    const textAnswers: LiveHostState['textAnswers'] = [];
    if (revealed && q) {
      if (q.type === 'text') {
        for (const p of participants) {
          const a = p.answers.get(idx);
          if (a && typeof a.value === 'string') {
            textAnswers.push({ name: p.name, value: a.value, correct: a.correct });
          }
        }
      } else {
        for (const o of q.options) {
          const n = participants.filter((p) => {
            const v = p.answers.get(idx)?.value;
            return Array.isArray(v) ? v.includes(o.id) : v === o.id;
          }).length;
          optionStats.push({ optionId: o.id, count: n });
        }
      }
    }

    return {
      role: 'host',
      ...this.common(room),
      classId: room.classId,
      className: room.className,
      joinCode: room.joinCode,
      question: q,
      participants: participants
        .map((p) => ({
          studentId: p.studentId,
          name: p.name,
          connected: p.connections > 0,
          score: p.score,
          answered: p.answers.has(idx),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'uk')),
      answeredCount: participants.filter((p) => p.answers.has(idx)).length,
      optionStats,
      textAnswers,
      leaderboard: this.leaderboard(room),
    };
  }

  playerState(sessionId: string, studentId: string): LivePlayerState | null {
    const room = this.rooms.get(sessionId);
    const p = room?.participants.get(studentId);
    if (!room || !p) return null;
    const q = room.questions[room.questionIndex] ?? null;
    const mine = p.answers.get(room.questionIndex) ?? null;
    const showBoard = !room.junior && (room.status === 'reveal' || room.status === 'finished');
    const place = this.ranked(room).findIndex((x) => x.studentId === studentId) + 1;
    return {
      role: 'player',
      ...this.common(room),
      name: p.name,
      question: q && room.status !== 'finished' ? toPublicQuestion(q) : null,
      myAnswer: mine?.value ?? null,
      myResult:
        room.status === 'reveal' && q
          ? {
              correct: mine?.correct ?? false,
              points: mine?.points ?? 0,
              correctAnswer: describeCorrectAnswer(q),
            }
          : null,
      myScore: p.score,
      myCorrectCount: [...p.answers.values()].filter((a) => a.correct).length,
      leaderboard: showBoard ? this.leaderboard(room) : [],
      myPlace: showBoard ? place : null,
    };
  }

  private common(room: Room) {
    return {
      sessionId: room.id,
      title: room.title,
      status: room.status,
      questionIndex: room.questionIndex,
      questionCount: room.questions.length,
      deadline: room.deadline,
      serverNow: Date.now(),
      junior: room.junior,
      showLeaderboard: !room.junior,
    };
  }

  // ---------- Housekeeping ----------

  private sweep() {
    const now = Date.now();
    for (const room of [...this.rooms.values()]) {
      if (room.status === 'finished') {
        if (room.finishedAt !== null && now - room.finishedAt > FINISHED_TTL_MS) {
          this.rooms.delete(room.id);
        }
      } else if (now - room.lastActivity > IDLE_TIMEOUT_MS) {
        void this.finish(room);
      }
    }
  }

  /** Graceful shutdown: save whatever results unfinished games have. */
  async shutdown() {
    clearInterval(this.sweeper);
    for (const room of this.rooms.values()) {
      if (room.status !== 'finished') await this.finish(room);
    }
    this.rooms.clear();
  }
}
