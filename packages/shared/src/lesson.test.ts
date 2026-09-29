import { describe, expect, it } from 'vitest';
import {
  addMinute,
  domainOf,
  durationText,
  isOnline,
  normalizeUrl,
  pcId,
  pcLabel,
  pcNum,
  progress,
  raisedHands,
  safeUrl,
  targetText,
  taskKey,
  taskStatus,
  timerLeft,
  visibleTask,
  type LessonTask,
  type PcCard,
} from './lesson.js';
import { lessonRows } from './results.js';
import type { Question } from './quiz.js';

describe('PC numbers', () => {
  it('parses and formats like Клас-пульт', () => {
    expect(['7', '07', 'pc07', ' 7 ', 'PC7'].map(pcNum)).toEqual([7, 7, 7, 7, 7]);
    expect(['0', '100', 'abc', '', '7a', null].map(pcNum)).toEqual([
      null,
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(pcLabel(7)).toBe('07');
    expect(pcId(7)).toBe('pc07');
  });
});

describe('links', () => {
  it('adds https:// and refuses other schemes', () => {
    expect(normalizeUrl('learningapps.org/123')).toBe('https://learningapps.org/123');
    expect(normalizeUrl('  http://example.com ')).toBe('http://example.com/');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('data:text/html,x')).toBeNull();
    expect(normalizeUrl('notadomain')).toBeNull();
    expect(normalizeUrl('')).toBeNull();
    expect(safeUrl('ftp://example.com')).toBeNull();
    expect(domainOf('https://www.example.com/a')).toBe('example.com');
  });
});

const task = (over: Partial<LessonTask> = {}): LessonTask => ({
  type: 'link',
  sentAt: 1000,
  target: null,
  url: 'https://example.com/',
  ...over,
});
const pc = (over: Partial<PcCard> = {}): PcCard => ({
  id: 'pc03',
  num: 3,
  name: 'Оля',
  studentId: null,
  lastSeen: 0,
  ...over,
});

describe('tasks on screens', () => {
  it('only the targeted PCs see a task', () => {
    const only3 = task({ target: ['pc03'] });
    expect(visibleTask(only3, 'pc03')).toBe(only3);
    expect(visibleTask(only3, 'pc07')).toBeNull();
    expect(visibleTask(task({ target: [] }), 'pc07')).not.toBeNull();
    expect(visibleTask(null, 'pc07')).toBeNull();
    expect(taskKey(only3)).toBe('link:1000');
    expect(targetText(['pc03', 'pc07'])).toBe('ПК 03, ПК 07');
    expect(targetText(null)).toBe('усім');
  });

  it('statuses and progress', () => {
    const t = task({ type: 'test' });
    expect(taskStatus(pc(), t)).toEqual({ kind: 'bad', text: 'ще не відкрив(ла)' });
    expect(taskStatus(pc({ openedAt: 1000 }), t)?.text).toBe('проходить тест');
    expect(taskStatus(pc({ submittedAt: 1000 }), t)?.text).toBe('здав(ла)');
    expect(taskStatus(pc({ doneAt: 1000 }), task())?.text).toBe('закінчив(ла)');
    expect(taskStatus(pc(), task({ target: ['pc07'] }))).toBeNull();
    const all = [pc({ submittedAt: 1000 }), pc({ id: 'pc04', openedAt: 1000 }), pc({ id: 'pc05' })];
    expect(progress(all, t)).toEqual({ total: 3, opened: 2, second: { label: 'Здали', count: 1 } });
  });

  it('online by server time, whatever the laptop clock says', () => {
    const serverNow = 10_000_000;
    const laptopAhead = serverNow + 2 * 3600_000; // laptop clock 2 hours ahead
    const skew = laptopAhead - serverNow;
    expect(isOnline(pc({ lastSeen: serverNow - 60_000 }), laptopAhead, skew)).toBe(true);
    expect(isOnline(pc({ lastSeen: serverNow - 200_000 }), laptopAhead, skew)).toBe(false);
    expect(isOnline(pc({ lastSeen: 0 }), laptopAhead, skew)).toBe(false);
  });

  it('raised hands in order; lowered ones are skipped', () => {
    const list = [
      pc({ id: 'pc05', handAt: 30, handId: 5 }),
      pc({ id: 'pc03', handAt: 10, handId: 3 }),
      pc({ id: 'pc04', handAt: 20, handId: 4 }),
      pc({ id: 'pc06' }),
    ];
    expect(raisedHands(list, { pc04: 4 }).map((p) => p.id)).toEqual(['pc03', 'pc05']);
    // A new hand (new handId) after being lowered counts again.
    expect(raisedHands(list, { pc04: 1 }).map((p) => p.id)).toEqual(['pc03', 'pc04', 'pc05']);
  });
});

describe('timer', () => {
  it('counts by server time and +1 min after the end starts from now', () => {
    const timer = { id: 1, durationMs: 300_000, startedAt: 1_000_000 };
    expect(timerLeft(timer, 1_000_500)).toBe(299_500);
    expect(durationText(299_500)).toBe('05:00');
    expect(durationText(-5)).toBe('00:00');
    expect(timerLeft({ ...timer, startedAt: 0 }, 5)).toBeNull();
    expect(timerLeft(null, 5)).toBeNull();
    expect(addMinute(timer, 1_000_000).durationMs).toBe(360_000);
    const over = addMinute(timer, 1_000_000 + 400_000); // 100 s over
    expect(timerLeft(over, 1_000_000 + 400_000)).toBe(60_000);
  });
});

describe('lesson results', () => {
  const questions: Question[] = [
    {
      id: 'q1',
      type: 'single',
      prompt: '2 + 2?',
      timeLimitSec: 30,
      options: [
        { id: 'a', text: '4' },
        { id: 'b', text: '5' },
      ],
      correctOptionId: 'a',
    },
  ];
  it('pupils and guests, sorted by PC; a guest PC counts its latest answers', () => {
    const rows = lessonRows({
      questions,
      submissions: [
        { studentId: 's1', attempt: 1, answers: { q1: 'a' }, submittedAt: 5, pcId: 'pc07' },
      ],
      guests: [
        { pcId: 'pc03', name: 'Гість', answers: { q1: 'a' }, submittedAt: 1 },
        { pcId: 'pc03', name: 'Гість', answers: { q1: 'b' }, submittedAt: 2 },
      ],
      names: new Map([['s1', 'Оля К.']]),
    });
    expect(rows.map((r) => [r.pcId, r.name, r.correctCount])).toEqual([
      ['pc03', 'Гість', 0],
      ['pc07', 'Оля К.', 1],
    ]);
  });
});
