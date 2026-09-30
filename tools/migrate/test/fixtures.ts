/*
 * Данные в формате Клас-пульта для проверки переноса: несколько уроков в разных
 * классах, повторная сдача с того же ПК, пропущенные ответы, ответы без сессии
 * (до 25.09.2026), класс без цифры в названии, удалённый потом тест. Плюс
 * «большой» день: 30 ПК × 6 тестов со случайными (но воспроизводимыми) ответами.
 */
import type { DumpDoc } from '../dump';

/** Воспроизводимый генератор случайных чисел (mulberry32). */
export function seeded(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const T0 = Date.UTC(2026, 8, 25, 7, 0); // 25.09.2026, 10:00 Kyiv
const ts = (ms: number) => ({ __ts: ms });

const TESTS = {
  algo: {
    title: 'Алгоритми',
    folder: '5 клас',
    questions: [
      { text: 'Що таке алгоритм?', options: ['Послідовність дій', 'Малюнок', 'Гра'] },
      { text: 'Виконавець робота?', options: ['Людина', 'Робот', 'Кіт', 'Сонце'] },
      { text: 'Цикл — це…', options: ['Повторення', 'Розгалуження'] },
    ],
    answers: [0, 1, 0],
  },
  net: {
    title: 'Мережі',
    folder: '6 клас',
    questions: [
      { text: "Що з'єднує комп'ютери у світі?", options: ['Інтернет', 'Принтер', 'Монітор'] },
      { text: 'Скільки біт у байті?', options: ['4', '8', '10'] },
    ],
    answers: [0, 1],
  },
  gone: {
    title: 'Видалений тест',
    folder: '',
    questions: [{ text: '2 + 2?', options: ['3', '4'] }],
    answers: [1],
  },
};

export function klasPultFixture(): DumpDoc[] {
  const docs: DumpDoc[] = [
    { path: 'secret/teacher', data: { code: '1234' } },
    { path: 'setup/state', data: { codeSet: true } },
    { path: 'control/state', data: { classLabel: '6-Б', resetAt: T0 + 3_000_000, locked: false } },
    { path: 'students/pc01', data: { pc: 'pc01', num: 1, name: 'Оля' } },
  ];
  for (const [id, t] of Object.entries(TESTS)) {
    if (id === 'gone') continue; // deleted from the bank; its session stays in History
    docs.push({
      path: `tests/${id}`,
      data: {
        title: t.title,
        folder: t.folder,
        questions: t.questions,
        count: t.questions.length,
        updatedAt: ts(T0 - 86_400_000),
      },
    });
    docs.push({ path: `keys/${id}`, data: { answers: t.answers } });
  }
  let n = 0;
  const session = (resetAt: number, testId: keyof typeof TESTS, label: string, at: number) => {
    const t = TESTS[testId];
    const id = `${resetAt}_${testId}`;
    docs.push({
      path: `sessions/${id}`,
      data: {
        testId,
        title: t.title,
        classLabel: label,
        resetAt,
        questions: t.questions,
        answers: t.answers,
        count: t.questions.length,
        startedAt: at,
        lastSentAt: at,
        summary: { submitted: 0, avgPercent: 0 },
      },
    });
    return id;
  };
  const result = (
    sessionId: string,
    pc: number,
    name: string,
    answers: number[],
    at: number,
    sentAt = 0,
  ) => {
    const pcId = `pc${String(pc).padStart(2, '0')}`;
    docs.push({
      path: `results/r${String(++n).padStart(4, '0')}`,
      data: {
        testId: sessionId.split('_')[1],
        sessionId,
        sentAt,
        pc: pcId,
        num: pc,
        name,
        answers,
        submittedAt: ts(at),
      },
    });
  };

  // 5-А, algorithms: a resubmission from PC 03, an empty answer, a spaced name.
  const s1 = session(T0, 'algo', '5-А', T0 + 60_000);
  result(s1, 3, 'Оля К.', [1, 1, 0], T0 + 300_000);
  result(s1, 3, 'Оля К.', [0, 1, 0], T0 + 360_000); // the last one counts
  result(s1, 7, '  Петро   М. ', [0, -1, 1], T0 + 320_000);
  result(s1, 12, 'Ірина', [0, 1, 0], T0 + 330_000);
  // 6-Б, networks, same day.
  const s2 = session(T0 + 3_000_000, 'net', '6-Б', T0 + 3_060_000);
  result(s2, 1, 'Оля', [0, 1], T0 + 3_200_000);
  result(s2, 2, 'Максим', [2, 0], T0 + 3_210_000);
  // «Гурток»: no digit → needs --grade; empty label → «Без назви».
  const s3 = session(T0 + 86_400_000, 'algo', 'Гурток', T0 + 86_460_000);
  result(s3, 5, 'Андрій', [0, 1, 0], T0 + 86_600_000);
  const s4 = session(T0 + 90_000_000, 'gone', '', T0 + 90_060_000);
  result(s4, 9, 'Гість', [1], T0 + 90_100_000);
  // A test nobody submitted.
  session(T0 + 95_000_000, 'net', '5-А', T0 + 95_060_000);
  // Before sessions existed: not in History, not moved.
  docs.push({
    path: 'results/old1',
    data: { pc: 'pc04', num: 4, name: 'Старий', answers: [0], submittedAt: ts(T0 - 999_000) },
  });

  // A big day: 30 PCs × 6 tests, random answers (some skipped), some resubmissions.
  const rnd = seeded(20260929);
  for (let k = 0; k < 6; k++) {
    const testId = k % 2 ? 'net' : 'algo';
    const label = ['7-В', '8-А', '9-Б'][k % 3]!;
    const start = T0 + (k + 2) * 2 * 86_400_000;
    const sid = session(start, testId, label, start + 1000);
    const t = TESTS[testId];
    for (let pc = 1; pc <= 30; pc++) {
      if (rnd() < 0.1) continue; // absent
      const tries = rnd() < 0.15 ? 2 : 1;
      for (let a = 0; a < tries; a++) {
        const answers = t.questions.map((q) =>
          rnd() < 0.1 ? -1 : Math.floor(rnd() * q.options.length),
        );
        result(sid, pc, `Учень ${pc}`, answers, start + 60_000 * (a + 1) + pc);
      }
    }
  }
  return docs;
}
