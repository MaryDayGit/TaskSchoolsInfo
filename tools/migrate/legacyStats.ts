/*
 * Баллы так, как их считает Клас-пульт (public/stats.js, `compute` и `latestAttempts`),
 * построчно — для сверки перенесённой истории с новой вкладкой «Історія».
 */
import { ms } from './plan';

export interface LegacyRow {
  pc: string;
  num: number;
  name: string;
  score: number | null;
}

export function legacyCompute(
  session: Record<string, unknown>,
  results: Record<string, unknown>[],
): { total: number; rows: LegacyRow[]; avgPercent: number } {
  const key = Array.isArray(session.answers) ? (session.answers as unknown[]) : null;
  const questions = Array.isArray(session.questions) ? session.questions : [];
  const total = key ? key.length : questions.length;

  // Последняя попытка каждого ПК (по времени сдачи на сервере, затем по sentAt).
  const latest = new Map<string, Record<string, unknown>>();
  for (const r of results) {
    if (typeof r.pc !== 'string') continue;
    const prev = latest.get(r.pc);
    const time = ms(r.submittedAt) ?? 0;
    const prevTime = prev ? (ms(prev.submittedAt) ?? 0) : 0;
    if (
      !prev ||
      time > prevTime ||
      (time === prevTime && Number(r.sentAt ?? 0) > Number(prev.sentAt ?? 0))
    ) {
      latest.set(r.pc, r);
    }
  }
  const pcNum = (pc: string) => Number(/^pc(\d{2})$/.exec(pc)?.[1] ?? 0);
  const rows = [...latest.values()]
    .map((r) => {
      const answers = Array.isArray(r.answers) ? r.answers : [];
      let score = 0;
      for (let i = 0; i < total; i++) {
        const a = typeof answers[i] === 'number' ? answers[i] : -1;
        if (a !== -1 && key && a === key[i]) score++;
      }
      return {
        pc: String(r.pc),
        num: typeof r.num === 'number' ? r.num : pcNum(String(r.pc)),
        name: String(r.name ?? ''),
        score: key ? score : null,
      };
    })
    .sort((a, b) => a.num - b.num);
  const sum = rows.reduce((acc, r) => acc + (r.score ?? 0), 0);
  const avg = rows.length && key ? sum / rows.length : 0;
  return {
    total,
    rows,
    avgPercent: total > 0 ? Math.round((avg * 100) / total) : 0,
  };
}
