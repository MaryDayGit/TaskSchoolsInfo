import type { Server as HttpServer } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { Server } from 'socket.io';
import type { ClientToServerEvents, LiveAck, ServerToClientEvents } from '@infoklas/shared';
import { STUDENT_COOKIE, TEACHER_COOKIE, verifyStudentToken, verifyTeacherToken } from '../auth.js';
import { HttpError } from '../lib/errors.js';
import { loadStudentById } from '../lib/studentContext.js';

interface SocketData {
  teacherId: string | null;
  student: { id: string; classId: string } | null;
  playerSessions: Set<string>;
}

const hostRoom = (sessionId: string) => `host:${sessionId}`;
const playerRoom = (sessionId: string, studentId: string) => `player:${sessionId}:${studentId}`;

/** Rejects cross-site WebSocket connections (the Origin must match the Host). */
function sameOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host) return true; // non-browser clients
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function attachLiveSocket(app: FastifyInstance, server: HttpServer) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, object, SocketData>(server, {
    path: '/socket.io',
    serveClient: false,
    allowRequest: (req, cb) => cb(null, sameOrigin(req.headers.origin, req.headers.host)),
  });

  const live = app.live;

  live.setNotifier((sessionId) => {
    const host = live.hostState(sessionId);
    if (host) io.to(hostRoom(sessionId)).emit('live:state', host);
    for (const studentId of live.playerIds(sessionId)) {
      const state = live.playerState(sessionId, studentId);
      if (state) io.to(playerRoom(sessionId, studentId)).emit('live:state', state);
    }
  });

  io.on('connection', (socket) => {
    const cookies = app.parseCookie(socket.handshake.headers.cookie ?? '');
    const student = verifyStudentToken(app, cookies[STUDENT_COOKIE]);
    socket.data = {
      teacherId: verifyTeacherToken(app, cookies[TEACHER_COOKIE]),
      student: student ? { id: student.sub, classId: student.cls } : null,
      playerSessions: new Set(),
    };

    /** Wraps a handler so errors become `{ ok: false, error }` acks. */
    const handle =
      <P>(fn: (p: P) => unknown) =>
      async (p: P, ack?: (r: LiveAck) => void) => {
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
          await fn(p);
          reply({ ok: true });
        } catch (err) {
          const message = err instanceof HttpError ? err.message : 'Помилка. Спробуйте ще раз.';
          if (!(err instanceof HttpError)) app.log.warn({ err }, 'live socket handler failed');
          reply({ ok: false, error: message });
        }
      };

    const teacher = () => {
      if (!socket.data.teacherId) throw new HttpError(401, 'Потрібно увійти як вчитель');
      return socket.data.teacherId;
    };
    const sessionIdOf = (p: unknown) => {
      const id = (p as { sessionId?: unknown } | null)?.sessionId;
      if (typeof id !== 'string') throw new HttpError(400, 'Некоректний запит');
      return id;
    };

    socket.on(
      'live:host',
      handle(async (p) => {
        const sessionId = sessionIdOf(p);
        live.assertHost(teacher(), sessionId);
        await socket.join(hostRoom(sessionId));
        const state = live.hostState(sessionId);
        if (state) socket.emit('live:state', state);
      }),
    );

    socket.on(
      'live:join',
      handle(async (p) => {
        const sessionId = sessionIdOf(p);
        const s = socket.data.student;
        if (!s) throw new HttpError(401, 'Потрібно увійти');
        const me = await loadStudentById(app.db, s.id, s.classId);
        live.joinPlayer(me.id, me.displayName, me.classId, sessionId);
        await socket.join(playerRoom(sessionId, me.id));
        if (!socket.data.playerSessions.has(sessionId)) {
          socket.data.playerSessions.add(sessionId);
          live.setConnected(sessionId, me.id, 1);
        }
        const state = live.playerState(sessionId, me.id);
        if (state) socket.emit('live:state', state);
      }),
    );

    socket.on(
      'live:start',
      handle((p) => live.start(teacher(), sessionIdOf(p))),
    );
    socket.on(
      'live:reveal',
      handle((p) => live.reveal(teacher(), sessionIdOf(p))),
    );
    socket.on(
      'live:next',
      handle((p) => live.next(teacher(), sessionIdOf(p))),
    );
    socket.on(
      'live:end',
      handle((p) => live.end(teacher(), sessionIdOf(p))),
    );

    socket.on(
      'live:answer',
      handle((p) => {
        const s = socket.data.student;
        const sessionId = sessionIdOf(p);
        if (!s || !socket.data.playerSessions.has(sessionId)) {
          throw new HttpError(401, 'Спочатку приєднайся до гри');
        }
        const { questionIndex, value } = p as { questionIndex: unknown; value: unknown };
        if (typeof questionIndex !== 'number') throw new HttpError(400, 'Некоректний запит');
        live.answer(s.id, sessionId, questionIndex, value);
      }),
    );

    socket.on('disconnect', () => {
      const s = socket.data.student;
      if (!s) return;
      for (const sessionId of socket.data.playerSessions) live.setConnected(sessionId, s.id, -1);
    });
  });

  return io;
}
