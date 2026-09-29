/*
 * Импорт тестов из текста (перенесён из Клас-пульта, public/importer.js).
 *
 * Формат (можно несколько тестов подряд):
 *
 *   # Алгоритми
 *   Папка: 5 клас                 ← необязательно
 *   1. Що таке алгоритм?
 *   * Послідовність дій            ← * или + — правильный вариант
 *   - Програма для малювання       ← - – — • — неправильный
 *   - Комп'ютер
 *
 *   2. Скільки буде 2 + 2?
 *   - 3
 *   * 4
 *
 * Правила: «#» начинает тест; строка без маркера — вопрос (номер «1.» или
 * «1)» в начале отбрасывается); строка без маркера сразу после вопроса без
 * вариантов продолжает его текст; у вопроса 2–6 вариантов и ровно один
 * правильный. Ошибки указывают номер строки.
 *
 * Формат не изменился; результат — вопросы типа `single` в формате платформы.
 */
import { DEFAULT_TIME_LIMIT_SEC, MAX_QUESTIONS, type Question } from './grading.js';

export const IMPORT_LIMITS = {
  title: 120,
  folder: 60,
  question: 500,
  option: 200,
  optionsMin: 2,
  optionsMax: 6,
  questions: MAX_QUESTIONS,
} as const;

export interface ImportedTest {
  title: string;
  folder: string;
  /** Line of the «# …» header. */
  line: number;
  questions: Question[];
}

export interface ImportError {
  line: number;
  /** Ukrainian, for the teacher. */
  message: string;
}

const HEADER = /^#+\s*(.*)$/;
const FOLDER = /^(папка|тема|розділ)\s*:\s*(.*)$/i;
const OPTION = /^([*+\-–—•])\s*(.*)$/;
const NUMBER = /^(питання\s*)?\d+\s*[.)]\s*/i;
const OPTION_IDS = 'abcdefgh';

function clean(value: string, max: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function short(text: string): string {
  const s = clean(text, 1000);
  return s.length > 40 ? s.slice(0, 40) + '…' : s;
}

interface DraftQuestion {
  text: string;
  options: { text: string; correct: boolean }[];
  line: number;
}

interface DraftTest {
  title: string;
  folder: string;
  line: number;
  questions: Question[];
  hadErrors: boolean;
}

export function parseImport(text: string): { tests: ImportedTest[]; errors: ImportError[] } {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const tests: ImportedTest[] = [];
  const errors: ImportError[] = [];
  let test: DraftTest | null = null;
  let question: DraftQuestion | null = null;
  let orphanReported = false;

  const error = (line: number, message: string): void => {
    errors.push({ line, message });
  };

  function finishQuestion() {
    if (!question || !test) return;
    const q = question;
    question = null;
    const label = `питання «${short(q.text)}»`;
    if (!q.text) return error(q.line, 'порожнє питання.');
    if (
      q.options.length < IMPORT_LIMITS.optionsMin ||
      q.options.length > IMPORT_LIMITS.optionsMax
    ) {
      return error(q.line, `${label}: потрібно від 2 до 6 варіантів (зараз ${q.options.length}).`);
    }
    const correct = q.options.flatMap((o, i) => (o.correct ? [i] : []));
    if (correct.length === 0) {
      return error(q.line, `${label}: немає правильної відповіді — позначте її зірочкою *.`);
    }
    if (correct.length > 1) {
      return error(q.line, `${label}: позначено кілька правильних відповідей — залиште одну *.`);
    }
    if (q.options.some((o) => !o.text)) return error(q.line, `${label}: є порожній варіант.`);
    test.questions.push({
      id: `q${test.questions.length + 1}`,
      type: 'single',
      prompt: q.text.slice(0, IMPORT_LIMITS.question),
      timeLimitSec: DEFAULT_TIME_LIMIT_SEC,
      options: q.options.map((o, i) => ({
        id: OPTION_IDS[i]!,
        text: o.text.slice(0, IMPORT_LIMITS.option),
      })),
      correctOptionId: OPTION_IDS[correct[0]!]!,
    });
  }

  function finishTest() {
    finishQuestion();
    if (!test) return;
    const t = test;
    test = null;
    if (!t.title) error(t.line, 'у тесту немає назви (після # має бути назва).');
    if (!t.questions.length && !t.hadErrors) {
      error(t.line, `у тесті «${t.title || '…'}» немає питань.`);
    }
    if (t.questions.length > IMPORT_LIMITS.questions) {
      error(t.line, `у тесті «${t.title}» більше ніж ${IMPORT_LIMITS.questions} питань.`);
    }
    if (t.title && t.questions.length && t.questions.length <= IMPORT_LIMITS.questions) {
      tests.push({ title: t.title, folder: t.folder, line: t.line, questions: t.questions });
    }
  }

  lines.forEach((raw, index) => {
    const n = index + 1;
    const line = raw.trim();
    if (!line) {
      // An empty line ends a question that already has options.
      if (question && question.options.length) finishQuestion();
      return;
    }

    const header = HEADER.exec(line);
    if (header) {
      finishTest();
      test = {
        title: clean(header[1] ?? '', IMPORT_LIMITS.title),
        folder: '',
        line: n,
        questions: [],
        hadErrors: false,
      };
      return;
    }

    if (!test) {
      if (!orphanReported) {
        error(n, 'почніть тест рядком з назвою, наприклад «# Алгоритми».');
        orphanReported = true;
      }
      return;
    }

    const folder = FOLDER.exec(line);
    if (folder && !question && !test.questions.length) {
      test.folder = clean(folder[2] ?? '', IMPORT_LIMITS.folder);
      return;
    }

    const option = OPTION.exec(line);
    if (option) {
      if (!question) {
        error(n, `варіант «${short(option[2] ?? '')}» без питання над ним.`);
        test.hadErrors = true;
        return;
      }
      question.options.push({
        text: clean(option[2] ?? '', IMPORT_LIMITS.option),
        correct: option[1] === '*' || option[1] === '+',
      });
      return;
    }

    // Question text: a continuation while there are no options yet, otherwise a new question.
    const textPart = line.replace(NUMBER, '');
    if (question && !question.options.length) {
      question.text = (question.text + '\n' + textPart).trim();
      return;
    }
    const before = errors.length;
    finishQuestion();
    if (errors.length > before) test.hadErrors = true;
    question = { text: textPart.trim(), options: [], line: n };
  });

  const before = errors.length;
  finishQuestion();
  if (test && errors.length > before) (test as DraftTest).hadErrors = true;
  finishTest();

  return { tests, errors: errors.sort((a, b) => a.line - b.line) };
}

export const IMPORT_EXAMPLE = [
  '# Алгоритми',
  'Папка: 5 клас',
  '1. Що таке алгоритм?',
  '* Послідовність дій для досягнення мети',
  '- Програма для малювання',
  '- Частина комп’ютера',
  '',
  '2. Скільки буде 2 + 2?',
  '- 3',
  '* 4',
  '',
  '# Цикли',
  'Папка: 6 клас',
  'Скільки разів виконається «повторити 3 рази»?',
  '- 2',
  '* 3',
  '- 4',
].join('\n');
