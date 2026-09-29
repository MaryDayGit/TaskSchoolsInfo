/*
 * Пульт урока: чистые функции Клас-пульта (common.js, admin.js, stats.js),
 * перенесённые почти построчно. Без Firebase и без DOM — их проверяют модульные
 * тесты, а страница ученика и пульт используют одни и те же правила.
 */

export const PC_MIN = 1;
export const PC_MAX = 99;
export const NAME_MAX = 60;
export const MESSAGE_MAX = 300;
export const LINK_TITLE_MAX = 120;
/** How often a pupil's PC writes lastSeen. Do not lower: Spark write limits. */
export const HEARTBEAT_MS = 60_000;
/** A PC is online if its lastSeen is fresher than this. */
export const ONLINE_MS = 150_000;

// ---------- PC numbers ----------

/** '7', '07', 'pc07' → 7; a wrong number → null. */
export function pcNum(value: unknown): number | null {
  const s = String(value ?? '')
    .trim()
    .replace(/^pc/i, '');
  if (!/^0*\d{1,2}$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n >= PC_MIN && n <= PC_MAX ? n : null;
}

/** 7 → '07' (for display). */
export const pcLabel = (num: number) => String(num).padStart(2, '0');

/** 7 → 'pc07' (document id). */
export const pcId = (num: number) => `pc${pcLabel(num)}`;

// ---------- Links ----------

const OTHER_SCHEMES = /^(javascript|data|vbscript|file|blob|about|mailto|tel|ftp):/i;

/** The URL only if it is http(s) with a real host, otherwise null. */
export function safeUrl(value: unknown): string | null {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  const host = url.hostname;
  if (!host || (!host.includes('.') && host !== 'localhost')) return null;
  return url.href;
}

/** What the teacher typed → a full URL; adds https:// when there is no scheme. */
export function normalizeUrl(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s) && !OTHER_SCHEMES.test(s)) {
    s = 'https://' + s.replace(/^\/+/, '');
  }
  return safeUrl(s);
}

/** 'https://www.example.com/a' → 'example.com'. */
export function domainOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '');
  } catch {
    return '';
  }
}

// ---------- Tasks on screens ----------

export type TaskType = 'link' | 'message' | 'test';

export interface LessonTask {
  type: TaskType;
  /** Teacher's Date.now() when sent; also the id of the task. */
  sentAt: number;
  /** null — everyone; otherwise pc ids. */
  target: string[] | null;
  url?: string;
  title?: string;
  text?: string;
  assignmentId?: string;
  count?: number;
}

export const TYPE_LABELS: Record<TaskType, string> = {
  link: 'Посилання',
  test: 'Тест',
  message: 'Повідомлення',
};

/** Changes only with a new task: the pupil's screen is redrawn only then. */
export const taskKey = (task: LessonTask | null | undefined) =>
  task ? `${task.type}:${task.sentAt}` : '';

export function isTarget(task: Pick<LessonTask, 'target'>, id: string): boolean {
  return !Array.isArray(task.target) || task.target.length === 0 || task.target.includes(id);
}

/** The task this PC should see, or null. */
export function visibleTask(task: LessonTask | null | undefined, id: string): LessonTask | null {
  if (!task || !task.type || !task.sentAt) return null;
  return isTarget(task, id) ? task : null;
}

/** «кому: усім» / «ПК 03, ПК 07». */
export function targetText(target: string[] | null | undefined): string {
  if (!Array.isArray(target) || !target.length) return 'усім';
  return target
    .map((id) => {
      const n = pcNum(id);
      return n === null ? id : `ПК ${pcLabel(n)}`;
    })
    .join(', ');
}

export interface PcCard {
  id: string;
  num: number;
  name: string;
  studentId: string | null;
  /** Server time, ms (0 — not yet). */
  lastSeen: number;
  openedAt?: number | null;
  submittedAt?: number | null;
  doneAt?: number | null;
  /** Server time, ms. */
  handAt?: number | null;
  handId?: number | null;
}

export type StatusKind = 'ok' | 'progress' | 'bad';

/** Status of a PC for the task on screens (Клас-пульт taskStatus). */
export function taskStatus(
  pc: PcCard,
  task: LessonTask | null | undefined,
): { kind: StatusKind; text: string } | null {
  if (!task || !task.type || !isTarget(task, pc.id)) return null;
  if (task.type === 'test') {
    if (pc.submittedAt === task.sentAt) return { kind: 'ok', text: 'здав(ла)' };
    if (pc.openedAt === task.sentAt) return { kind: 'progress', text: 'проходить тест' };
    return { kind: 'bad', text: 'ще не відкрив(ла)' };
  }
  if (pc.doneAt === task.sentAt) return { kind: 'ok', text: 'закінчив(ла)' };
  if (pc.openedAt === task.sentAt) return { kind: 'ok', text: 'відкрив(ла)' };
  return { kind: 'bad', text: 'ще не відкрив(ла)' };
}

/** «Відкрили / Здали / Закінчили: X з Y». */
export function progress(pcs: PcCard[], task: LessonTask) {
  const targeted = pcs.filter((p) => isTarget(task, p.id));
  const total = task.target?.length ? task.target.length : pcs.length;
  const opened = targeted.filter(
    (p) => p.openedAt === task.sentAt || p.submittedAt === task.sentAt || p.doneAt === task.sentAt,
  ).length;
  const second =
    task.type === 'test'
      ? { label: 'Здали', count: targeted.filter((p) => p.submittedAt === task.sentAt).length }
      : { label: 'Закінчили', count: targeted.filter((p) => p.doneAt === task.sentAt).length };
  return { total, opened, second };
}

/**
 * Online by server time. `skew` = teacher's clock − server clock (the minimum of
 * `Date.now() − lastSeen` over fresh changes), so a wrong laptop clock doesn't
 * make everybody "offline".
 */
export function isOnline(pc: Pick<PcCard, 'lastSeen'>, localNow: number, skew: number): boolean {
  return pc.lastSeen > 0 && localNow - skew - pc.lastSeen < ONLINE_MS;
}

/** Raised hands in queue order; a hand the teacher lowered (handsDown) doesn't count. */
export function raisedHands(pcs: PcCard[], handsDown: Record<string, number> | null | undefined) {
  const down = handsDown ?? {};
  return pcs
    .filter((p) => p.handAt && p.handId && down[p.id] !== p.handId)
    .sort((a, b) => (a.handAt ?? 0) - (b.handAt ?? 0));
}

// ---------- Timer (server time) ----------

export interface LessonTimer {
  id: number;
  durationMs: number;
  /** Server time, ms; 0 while the server hasn't confirmed it. */
  startedAt: number;
}

/** Time left, or null when there is no timer or its start is not known yet. */
export function timerLeft(timer: LessonTimer | null | undefined, serverNow: number): number | null {
  if (!timer || !timer.id || !timer.durationMs || !timer.startedAt) return null;
  return timer.durationMs - (serverNow - timer.startedAt);
}

/** 299 500 ms → '05:00' (rounded up to a second). */
export function durationText(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** «+1 хв»: if the time is already over, one minute from now. */
export function addMinute(timer: LessonTimer, serverNow: number): LessonTimer {
  const left = timerLeft(timer, serverNow);
  const extra = left !== null && left < 0 ? 60_000 - left : 60_000;
  return { ...timer, durationMs: timer.durationMs + extra };
}
