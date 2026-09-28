import type { PublicQuestion, Question, AnswerValue } from './quiz.js';

export type LiveStatus = 'lobby' | 'question' | 'reveal' | 'finished';

export interface LiveParticipant {
  studentId: string;
  name: string;
  connected: boolean;
  score: number;
  answered: boolean;
}

export interface LiveLeaderboardEntry {
  name: string;
  score: number;
}

export interface LiveOptionStat {
  optionId: string;
  count: number;
}

export interface LiveTextAnswer {
  name: string;
  value: string;
  correct: boolean;
}

interface LiveCommon {
  sessionId: string;
  title: string;
  status: LiveStatus;
  questionIndex: number;
  questionCount: number;
  /** Epoch ms when the current question closes (status 'question' only). */
  deadline: number | null;
  /** Server clock, so clients can correct for skew when showing a countdown. */
  serverNow: number;
  junior: boolean;
  showLeaderboard: boolean;
}

export interface LiveHostState extends LiveCommon {
  role: 'host';
  classId: string;
  className: string;
  /** Shown in the lobby so students who aren't logged in yet can join. */
  joinCode: string;
  question: Question | null;
  participants: LiveParticipant[];
  answeredCount: number;
  /** Filled at 'reveal' for choice questions. */
  optionStats: LiveOptionStat[];
  /** Filled at 'reveal' for text questions. */
  textAnswers: LiveTextAnswer[];
  leaderboard: LiveLeaderboardEntry[];
}

export interface LivePlayerState extends LiveCommon {
  role: 'player';
  name: string;
  question: PublicQuestion | null;
  myAnswer: AnswerValue | null;
  /** Filled at 'reveal'. */
  myResult: { correct: boolean; points: number; correctAnswer: string } | null;
  myScore: number;
  myCorrectCount: number;
  leaderboard: LiveLeaderboardEntry[];
  myPlace: number | null;
}

export type LiveState = LiveHostState | LivePlayerState;

export interface LiveAck {
  ok: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  'live:host': (p: { sessionId: string }, ack: (r: LiveAck) => void) => void;
  'live:join': (p: { sessionId: string }, ack: (r: LiveAck) => void) => void;
  'live:start': (p: { sessionId: string }, ack: (r: LiveAck) => void) => void;
  'live:reveal': (p: { sessionId: string }, ack: (r: LiveAck) => void) => void;
  'live:next': (p: { sessionId: string }, ack: (r: LiveAck) => void) => void;
  'live:end': (p: { sessionId: string }, ack: (r: LiveAck) => void) => void;
  'live:answer': (
    p: { sessionId: string; questionIndex: number; value: AnswerValue },
    ack: (r: LiveAck) => void,
  ) => void;
}

export interface ServerToClientEvents {
  'live:state': (s: LiveState) => void;
}
