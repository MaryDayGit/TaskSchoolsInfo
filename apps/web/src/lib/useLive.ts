import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  LiveAck,
  LiveHostState,
  LivePlayerState,
  ServerToClientEvents,
} from '@infoklas/shared';

type LiveSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
type Command = 'live:start' | 'live:reveal' | 'live:next' | 'live:end';

/**
 * Connects to a live game as host or player. Re-joins automatically after
 * reconnects (e.g. a phone that went to sleep or flaky school Wi‑Fi).
 */
export function useLive<R extends 'host' | 'player'>(role: R, sessionId: string) {
  type State = R extends 'host' ? LiveHostState : LivePlayerState;
  const socketRef = useRef<LiveSocket | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Local clock minus server clock, for accurate countdowns. */
  const [clockOffset, setClockOffset] = useState(0);

  useEffect(() => {
    const socket: LiveSocket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    const join = () => {
      setConnected(true);
      socket.emit(role === 'host' ? 'live:host' : 'live:join', { sessionId }, (r: LiveAck) => {
        setError(r.ok ? null : (r.error ?? 'Не вдалося приєднатися'));
      });
    };
    socket.on('connect', join);
    socket.on('disconnect', () => setConnected(false));
    socket.on('live:state', (s) => {
      setClockOffset(Date.now() - s.serverNow);
      setState(s as State);
    });
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [role, sessionId]);

  const command = useCallback(
    (event: Command) =>
      new Promise<LiveAck>((resolve) => {
        const socket = socketRef.current;
        if (!socket) return resolve({ ok: false, error: "Немає з'єднання" });
        socket.emit(event, { sessionId }, (r: LiveAck) => {
          if (!r.ok) setError(r.error ?? 'Помилка');
          resolve(r);
        });
      }),
    [sessionId],
  );

  const answer = useCallback(
    (questionIndex: number, value: string | string[]) =>
      new Promise<LiveAck>((resolve) => {
        const socket = socketRef.current;
        if (!socket) return resolve({ ok: false, error: "Немає з'єднання" });
        socket.emit('live:answer', { sessionId, questionIndex, value }, resolve);
      }),
    [sessionId],
  );

  return { state, connected, error, clockOffset, command, answer };
}

/**
 * Seconds left until `deadline` (server time), updated 4× per second. Capped at
 * `maxSeconds`: the clock offset includes network latency, which would otherwise
 * briefly show more time than the question has.
 */
export function useCountdown(
  deadline: number | null,
  clockOffset: number,
  maxSeconds = Infinity,
): number | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (deadline === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline]);
  if (deadline === null) return null;
  return Math.min(maxSeconds, Math.max(0, Math.ceil((deadline - (now - clockOffset)) / 1000)));
}
