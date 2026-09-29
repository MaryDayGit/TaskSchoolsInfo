// Ported from Клас-пульт tests/importer.test.js: the text format is unchanged.
import { describe, expect, it } from 'vitest';
import { IMPORT_EXAMPLE, parseImport } from './importer.js';
import { questionListSchema } from './quiz.js';

const simple = (q: { prompt: string; options?: { text: string }[]; correctOptionId?: string }) => ({
  text: q.prompt,
  options: q.options?.map((o) => o.text),
  correct: q.options?.findIndex((o) => 'abcdefgh'[q.options!.indexOf(o)] === q.correctOptionId),
});

describe('parseImport', () => {
  it('the hint example gives two tests of valid single-choice questions', () => {
    const { tests, errors } = parseImport(IMPORT_EXAMPLE);
    expect(errors).toEqual([]);
    expect(tests).toHaveLength(2);
    const [a, b] = tests;
    expect(a!.title).toBe('Алгоритми');
    expect(a!.folder).toBe('5 клас');
    expect(a!.questions[0]).toEqual({
      id: 'q1',
      type: 'single',
      prompt: 'Що таке алгоритм?',
      timeLimitSec: 30,
      options: [
        { id: 'a', text: 'Послідовність дій для досягнення мети' },
        { id: 'b', text: 'Програма для малювання' },
        { id: 'c', text: 'Частина комп’ютера' },
      ],
      correctOptionId: 'a',
    });
    expect(simple(a!.questions[1] as never)).toEqual({
      text: 'Скільки буде 2 + 2?',
      options: ['3', '4'],
      correct: 1,
    });
    expect(b!.title).toBe('Цикли');
    expect(b!.folder).toBe('6 клас');
    // The result passes the same schema as the editor.
    for (const t of tests) expect(questionListSchema.safeParse(t.questions).success).toBe(true);
  });

  it('markers: + is correct too, dashes and bullets from Word are wrong, numbers are dropped', () => {
    const { tests, errors } = parseImport(
      ['# Тест', '1) Перше питання', '• а', '+ б', '– в', 'Питання 2. Друге', '— так', '* ні'].join(
        '\r\n',
      ),
    );
    expect(errors).toEqual([]);
    expect(tests[0]!.questions.map((q) => simple(q as never))).toEqual([
      { text: 'Перше питання', options: ['а', 'б', 'в'], correct: 1 },
      { text: 'Друге', options: ['так', 'ні'], correct: 1 },
    ]);
  });

  it('multi-line questions and questions without empty lines between them', () => {
    const { tests, errors } = parseImport(
      [
        '# Код',
        'Що виведе програма?',
        'print(2 * 3)',
        '* 6',
        '- 23',
        'Наступне питання',
        '* так',
        '- ні',
      ].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(tests[0]!.questions[0]!.prompt).toBe('Що виведе програма?\nprint(2 * 3)');
    expect(tests[0]!.questions).toHaveLength(2);
  });

  it('errors carry line numbers', () => {
    const { tests, errors } = parseImport(
      [
        'Без заголовка', // 1
        '# Тест', // 2
        'Немає правильної', // 3
        '- а', // 4
        '- б', // 5
        '', // 6
        'Дві правильні', // 7
        '* а', // 8
        '* б', // 9
        '', // 10
        'Один варіант', // 11
        '* а', // 12
        '', // 13
        '- варіант без питання', // 14
      ].join('\n'),
    );
    expect(errors.map((e) => e.line)).toEqual([1, 3, 7, 11, 14]);
    expect(errors[1]!.message).toMatch(/зірочкою/);
    expect(errors[2]!.message).toMatch(/кілька правильних/);
    expect(errors[3]!.message).toMatch(/від 2 до 6/);
    expect(errors[4]!.message).toMatch(/без питання/);
    expect(tests).toEqual([]);
  });

  it('a test without questions and a test without a title', () => {
    const { tests, errors } = parseImport('# Порожній\n\n#\nПитання\n* а\n- б');
    expect(tests).toEqual([]);
    expect(errors.map((e) => e.line)).toEqual([1, 3]);
  });

  it('more than 50 questions is reported (the platform limit)', () => {
    const body = Array.from({ length: 51 }, (_, i) => `Питання ${i + 1}\n* так\n- ні\n`).join('\n');
    const { tests, errors } = parseImport(`# Великий\n${body}`);
    expect(tests).toEqual([]);
    expect(errors[0]!.message).toMatch(/більше ніж 50/);
  });

  it('empty text gives neither tests nor errors', () => {
    expect(parseImport('   \n  ')).toEqual({ tests: [], errors: [] });
  });
});
