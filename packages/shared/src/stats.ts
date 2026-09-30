/*
 * Статистика теста урока для вкладки «Історія» (бывший stats.js Клас-пульта):
 * сколько сдали, средний балл, распределение баллов, по каждому вопросу — сколько
 * ответили правильно и что выбирали, самый трудный вопрос, CSV для Excel.
 *
 * Строки — `lessonRows()`: лучшая попытка ученика из списка класса и последняя
 * сдача гостевого ПК. Средний процент считается как в Клас-пульте: от среднего
 * балла (а не среднее процентов), чтобы перенесённая история совпадала.
 */
import { toCsv } from './csv.js';
import type { Question } from './grading.js';
import { pcLabel } from './lesson.js';
import { percent, type LessonRow } from './results.js';

export interface OptionStat {
  id: string;
  text: string;
  count: number;
  correct: boolean;
}

export interface QuestionStat {
  index: number;
  questionId: string;
  prompt: string;
  /** How many chose each option; `null` for a word answer. */
  options: OptionStat[] | null;
  /** Rows without an answer to this question. */
  none: number;
  correct: number;
  /** Share of rows answering correctly. */
  percent: number;
}

export interface HistoryStats {
  total: number;
  rows: LessonRow[];
  submitted: number;
  /** Mean score (points out of `total`). */
  avg: number;
  avgPercent: number;
  /** distribution[s] = rows with score s, s = 0…total. */
  distribution: number[];
  perQuestion: QuestionStat[];
  /** The question with the lowest share of correct answers (the first of equal ones). */
  hardest: QuestionStat | null;
}

const chose = (value: unknown, id: string) =>
  Array.isArray(value) ? value.includes(id) : value === id;

export function historyStats(questions: Question[], rows: LessonRow[]): HistoryStats {
  const total = questions.length;
  const perQuestion: QuestionStat[] = questions.map((q, i) => {
    let none = 0;
    let correct = 0;
    for (const r of rows) {
      const v = r.answers[q.id];
      if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) none++;
      if (r.perQuestion[i]) correct++;
    }
    const options =
      q.type === 'text'
        ? null
        : q.options.map((o) => ({
            id: o.id,
            text: o.text,
            count: rows.filter((r) => chose(r.answers[q.id], o.id)).length,
            correct:
              q.type === 'single' ? q.correctOptionId === o.id : q.correctOptionIds.includes(o.id),
          }));
    return {
      index: i,
      questionId: q.id,
      prompt: q.prompt,
      options,
      none,
      correct,
      percent: percent(correct, rows.length),
    };
  });

  const distribution = Array.from({ length: total + 1 }, () => 0);
  let sum = 0;
  for (const r of rows) {
    distribution[Math.min(total, r.correctCount)]!++;
    sum += r.correctCount;
  }
  const avg = rows.length ? sum / rows.length : 0;
  let hardest: QuestionStat | null = null;
  if (rows.length) {
    for (const q of perQuestion) if (!hardest || q.percent < hardest.percent) hardest = q;
  }
  return {
    total,
    rows,
    submitted: rows.length,
    avg,
    avgPercent: percent(avg, total),
    distribution,
    perQuestion,
    hardest,
  };
}

/** The short summary kept on the assignment for the History list. */
export const historySummary = (s: HistoryStats) => ({
  submitted: s.submitted,
  avgPercent: s.avgPercent,
});

export interface DistributionBin {
  label: string;
  count: number;
}

/** A column per score 0…total; with more than 20 questions, ten 10 % bins. */
export function distributionBins(s: HistoryStats): DistributionBin[] {
  if (s.total <= 20) return s.distribution.map((count, score) => ({ label: String(score), count }));
  const bins = Array.from({ length: 10 }, (_, b) => ({
    label: `${b * 10}–${b === 9 ? 100 : b * 10 + 9}%`,
    count: 0,
  }));
  for (const r of s.rows)
    bins[Math.min(9, Math.floor(percent(r.correctCount, s.total) / 10))]!.count++;
  return bins;
}

/** «4,3» — one decimal with a comma. */
export const avgText = (avg: number) => String(Math.round(avg * 10) / 10).replace('.', ',');

/** Row label of a PC: «ПК 07»; a pupil who logged in at home has none. */
export const pcText = (pcId: string | null) =>
  pcId && /^pc\d{2}$/.test(pcId) ? `ПК ${pcLabel(Number(pcId.slice(2)))}` : '';

/**
 * CSV like Клас-пульт: ПК; Учень; Статус; Бал; Максимум; Питання 1…N (1 / 0 / пусто),
 * then the ones who did not submit.
 */
export function historyCsv(
  s: HistoryStats,
  missing: { pcId: string | null; name: string }[] = [],
): string {
  const header = ['ПК', 'Учень', 'Статус', 'Бал', 'Максимум'];
  for (let i = 0; i < s.total; i++) header.push(`Питання ${i + 1}`);
  const lines = [header];
  for (const r of s.rows) {
    lines.push([
      pcText(r.pcId),
      r.name,
      'здав(ла)',
      String(r.correctCount),
      String(s.total),
      ...s.perQuestion.map((q, i) => {
        const v = r.answers[q.questionId];
        if (v === undefined || v === '' || (Array.isArray(v) && !v.length)) return '';
        return r.perQuestion[i] ? '1' : '0';
      }),
    ]);
  }
  for (const m of missing) {
    lines.push([pcText(m.pcId), m.name, 'не здав(ла)', '', String(s.total)]);
  }
  return toCsv(lines);
}

/** «Результати - Мережі - 6-В - 2026-09-29.csv» */
export function historyFileName(title: string, className: string, ms: number): string {
  const d = new Date(ms);
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const safe = (v: string, max: number) =>
    v
      .replace(/[\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, max);
  const parts = ['Результати', safe(title, 60) || 'тест'];
  if (safe(className, 30)) parts.push(safe(className, 30));
  parts.push(date);
  return `${parts.join(' - ')}.csv`;
}
