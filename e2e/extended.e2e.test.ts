/*
 * Расширенная проверка на эмуляторе (docs/platform/TESTING.md, A.6): всё, что не
 * вошло в сценарии этапов — редактор и банк, управление классом, режимы домашних
 * заданий, кнопки пульта, варианты живой игры, работа без сети и на медленном
 * интернете, нагрузка в 30 учеников, часовой пояс Киева, доступность (axe).
 * Отдельная база: файл сам очищает эмулятор и заводит код учителя.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, onTestFailed } from 'vitest';
import type { Browser, BrowserContext } from 'playwright-core';
import { BASE_URL, computer, launch, open, resetEmulators, type TrackedPage } from './helpers';
import {
  addStudents,
  createClass,
  firstRun,
  pictures,
  pupilWithPictures,
  pupilWithWord,
  words,
} from './flows';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { PICTURES } from '@infoklas/shared/pictures';
import { adminDb, closeAdmin } from './migrate';
import { VirtualPupil } from './virtual';

const require = createRequire(import.meta.url);

let browser: Browser;
let teacherPc: BrowserContext;
let t: TrackedPage;
const opened: BrowserContext[] = [];

beforeAll(async () => {
  await resetEmulators();
  browser = await launch();
  // School PCs and the teacher are in Kyiv: dates must be shown in local time.
  teacherPc = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'uk-UA',
    timezoneId: 'Europe/Kyiv',
  });
  t = await firstRun(teacherPc, '7777');
});

afterAll(async () => {
  await closeAdmin();
  for (const c of opened) await c.close().catch(() => {});
  await browser?.close();
});

// A screenshot of the teacher's page when a scenario fails (SCREENSHOT_DIR).
beforeEach((ctx) => {
  if (t) t.errors.length = 0;
  onTestFailed(async () => {
    if (t?.errors.length) process.stdout.write(`\n[errors] ${t.errors.join('\n')}\n`);
    if (!process.env.SCREENSHOT_DIR || !t) return;
    const name = ctx.task.name.replace(/[^\p{L}\p{N}]+/gu, '-').slice(0, 60);
    await t.screenshot({ path: `${process.env.SCREENSHOT_DIR}/fail-${name}.png`, fullPage: true });
  });
});

const bank = async () => {
  await t.goto(`${BASE_URL}/t/quizzes`);
  await t.getByRole('heading', { name: 'Банк тестів' }).waitFor();
};

describe('bank and editor', () => {
  it('builds a test with all question types, reorders, keeps unsaved changes safe', async () => {
    await bank();
    await t.getByRole('button', { name: 'Створити тест' }).click();
    await t.getByRole('button', { name: /Написати самостійно/ }).click();
    await t.getByLabel('Назва тесту').fill('Пристрої');
    await t.getByLabel('Папка').fill('Перевірка');

    // Q1: one right answer, 4 options → one removed.
    const q1 = t.getByTestId('question-1');
    await q1.getByLabel('Текст питання').fill('Пристрій введення?');
    for (const [i, text] of ['Клавіатура', 'Монітор', 'Принтер', 'Колонки'].entries()) {
      await q1.getByLabel(`Варіант ${i + 1}`, { exact: true }).fill(text);
    }
    await q1.getByRole('button', { name: 'Правильна відповідь: варіант 1' }).click();
    await q1.getByRole('button', { name: 'Прибрати варіант 4' }).click();
    expect(await q1.getByLabel(/^Варіант \d$/).count()).toBe(3);

    // Q2: several right answers.
    await t.getByRole('button', { name: /Один правильний варіант/ }).click();
    const q2 = t.getByTestId('question-2');
    await q2.getByLabel('Тип питання').selectOption({ label: 'Кілька правильних відповідей' });
    await q2.getByLabel('Текст питання').fill('Що є пристроями виведення?');
    for (const [i, text] of ['Монітор', 'Мишка', 'Принтер', 'Сканер'].entries()) {
      await q2.getByLabel(`Варіант ${i + 1}`, { exact: true }).fill(text);
    }
    // Switching the type keeps option 1 marked; mark option 3 too.
    expect(
      await q2
        .getByRole('button', { name: 'Правильна відповідь: варіант 1' })
        .getAttribute('aria-pressed'),
    ).toBe('true');
    await q2.getByRole('button', { name: 'Правильна відповідь: варіант 3' }).click();
    await q2.getByLabel('Час у живій грі').selectOption('10');

    // Q3: a word with two spellings, then moved to the top.
    await t.getByRole('button', { name: /Відповідь словом/ }).click();
    const q3 = t.getByTestId('question-3');
    await q3.getByLabel('Текст питання').fill('Мозок комп’ютера?');
    await q3.getByLabel('Правильна відповідь').fill('процесор');
    await q3.getByRole('button', { name: 'Ще варіант написання' }).click();
    await q3.getByLabel('Інший варіант написання 1').fill('ЦП');
    await q3.getByRole('button', { name: 'Вгору' }).click();
    await t.getByTestId('question-2').getByLabel('Текст питання').waitFor();
    expect(await t.getByTestId('question-2').getByLabel('Текст питання').inputValue()).toBe(
      'Мозок комп’ютера?',
    );

    await t.getByRole('button', { name: 'Зберегти' }).click();
    await t.waitForURL(/\/t\/quizzes\/[^/]+$/);
    // The new test opens from the database (the editor of the new id). Wait for it:
    // a reload in the very same moment would still meet «leave without saving?».
    await t.waitForTimeout(1000);
    await t.reload();
    await t.getByTestId('question-3').getByLabel('Текст питання').waitFor({ timeout: 15_000 });

    // An unsaved change asks before leaving; «Скасувати» keeps the editor.
    await t.getByTestId('question-1').getByLabel('Текст питання').fill('Пристрій введення даних?');
    await t.getByRole('button', { name: '← Тести' }).click();
    const leave = t.getByRole('alertdialog', { name: 'Вийти без збереження?' });
    await leave.getByRole('button', { name: 'Скасувати' }).click();
    await t.getByRole('button', { name: 'Зберегти' }).click();
    await t.getByRole('status').getByText('Збережено').waitFor();

    // After a reload everything is where it was.
    await t.reload();
    await t.getByTestId('question-1').getByLabel('Текст питання').waitFor({ timeout: 15_000 });
    expect(await t.getByTestId('question-1').getByLabel('Текст питання').inputValue()).toBe(
      'Пристрій введення даних?',
    );
    expect(
      await t.getByTestId('question-2').getByLabel('Інший варіант написання 1').inputValue(),
    ).toBe('ЦП');
    expect(await t.getByTestId('question-3').getByLabel('Час у живій грі').inputValue()).toBe('10');
    expect(t.errors).toEqual([]);
  });

  it('bank: search, folders, copy, template, answers, delete', async () => {
    await bank();
    await t.getByRole('button', { name: 'Використати' }).first().click();
    await t.waitForURL(/\/t\/quizzes\/[^/]+$/);
    await bank();
    await t.getByRole('heading', { name: 'Шаблони · 1' }).waitFor();

    await t.getByTestId('quiz-Пристрої').getByRole('button', { name: 'Копія' }).click();
    await t.waitForURL(/\/t\/quizzes\/[^/]+$/);
    await bank();
    await t.getByTestId('quiz-Пристрої (копія)').waitFor();

    await t.getByLabel('Пошук за назвою').fill('копія');
    await t.getByTestId('quiz-Пристрої (копія)').waitFor();
    expect(await t.getByTestId('quiz-Пристрої').count()).toBe(0);
    await t.getByLabel('Пошук за назвою').fill('нема такого');
    await t.getByText('Нічого не знайдено.').waitFor();
    await t.getByLabel('Пошук за назвою').fill('');
    await t.getByLabel('Папка').selectOption('Шаблони');
    expect(await t.getByTestId('quiz-Пристрої').count()).toBe(0);
    await t.getByLabel('Папка').selectOption('');

    await t.getByTestId('quiz-Пристрої').getByRole('button', { name: 'Відповіді' }).click();
    const key = t.getByRole('dialog', { name: 'Відповіді: Пристрої' });
    await key.getByText('процесор / ЦП').waitFor();
    await key.locator('.answer-ok', { hasText: 'Монітор' }).waitFor();
    await key.locator('.answer-ok', { hasText: 'Принтер' }).waitFor();
    await key.getByRole('button', { name: 'Закрити' }).click();

    await t.getByTestId('quiz-Пристрої (копія)').getByRole('button', { name: 'Видалити' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Видалити' }).click();
    await t.getByTestId('quiz-Пристрої (копія)').waitFor({ state: 'detached' });
    // Deleted in the database too (not only on the screen).
    await expect
      .poll(async () =>
        (await adminDb().collection('quizzes').get()).docs.map((d) => d.get('title') as string),
      )
      .not.toContain('Пристрої (копія)');
    expect(t.errors).toEqual([]);
  });
});

describe('classes', () => {
  it('rename, change grade, new class code (the old one stops working), delete', async () => {
    const code = await createClass(t, '9-Т', 9);
    await addStudents(t, ['Тарас']);
    await t.getByRole('button', { name: 'Налаштування' }).click();
    const dlg = t.getByRole('dialog', { name: 'Налаштування класу' });
    await dlg.getByLabel('Назва класу').fill('9-Тест');
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await t.getByRole('heading', { name: 'Клас 9-Тест' }).waitFor();

    await t.getByRole('button', { name: 'Налаштування' }).click();
    await t.getByRole('button', { name: 'Новий код класу' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Змінити код' }).click();
    await t.getByTestId('join-code').locator('strong').filter({ hasNotText: code }).waitFor();
    const fresh = (await t.getByTestId('join-code').locator('strong').textContent())!.trim();
    await t.keyboard.press('Escape');

    const ctx = await computer(browser);
    opened.push(ctx);
    const p = await open(ctx, '/');
    await p.getByLabel('Код класу').fill(code);
    await p.getByRole('button', { name: 'Далі' }).click();
    await p.getByRole('alert').getByText('Клас з таким кодом не знайдено').waitFor();
    await p.getByLabel('Код класу').fill(fresh);
    await p.getByRole('button', { name: 'Далі' }).click();
    await p.getByRole('button', { name: 'Тарас' }).waitFor();
    expect(p.errors).toEqual([]);

    await t.getByRole('button', { name: 'Налаштування' }).click();
    await t.getByRole('button', { name: 'Видалити клас' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Видалити' }).click();
    await t.getByRole('heading', { name: 'Мої класи' }).waitFor();
    expect(await t.getByText('9-Тест').count()).toBe(0);
    expect(t.errors).toEqual([]);
  });
});

describe('homework modes', () => {
  const NAMES = ['Ярина', 'Остап'];
  let code = '';
  let pw: string[] = [];
  let yaryna: TrackedPage;

  it('«не показувати»: the pupil gets no answers; a multiple-choice answer is graded', async () => {
    code = await createClass(t, '8-Д', 8);
    await addStudents(t, NAMES);
    pw = await words(t, NAMES);
    await t.getByRole('tab', { name: 'Завдання' }).click();
    await t.getByRole('button', { name: 'Дати завдання' }).click();
    const dlg = t.getByRole('dialog', { name: 'Дати завдання' });
    await dlg.getByLabel('Тест').selectOption({ label: 'Пристрої (3 питання)' });
    await dlg.getByLabel('Кількість спроб').selectOption('1');
    await dlg.getByLabel('Правильні відповіді учням').selectOption({ label: 'Не показувати' });
    await dlg.getByRole('button', { name: 'Видати завдання' }).click();
    await t
      .getByRole('dialog', { name: 'Завдання видано' })
      .getByRole('button', { name: 'Готово' })
      .click();

    const y = await pupilWithWord(browser, code, NAMES[0]!, pw[0]!);
    opened.push(y.ctx);
    yaryna = y.page;
    await yaryna.getByTestId('hw-Пристрої').click();
    await yaryna.getByRole('button', { name: 'Почати' }).click();
    await yaryna.getByRole('radio', { name: 'Клавіатура' }).click();
    // «Прочитати» is only for grades 2–4.
    expect(await yaryna.getByRole('button', { name: 'Прочитати' }).count()).toBe(0);
    await yaryna.getByRole('button', { name: 'Далі →' }).click();
    await yaryna.getByLabel('Відповідь').fill('Процесор');
    await yaryna.getByRole('button', { name: 'Далі →' }).click();
    await yaryna.getByText('Обери всі правильні відповіді').waitFor();
    await yaryna.getByRole('checkbox', { name: 'Монітор' }).click();
    await yaryna.getByRole('checkbox', { name: 'Принтер' }).click();
    await yaryna.getByRole('button', { name: 'Завершити' }).click();
    await yaryna.getByRole('button', { name: 'Надіслати' }).click();
    await yaryna.getByTestId('hw-sent').getByText('Результат покаже вчитель.').waitFor();
    expect(await yaryna.locator('.review').count()).toBe(0);

    await t.getByTestId('work-Пристрої').getByRole('link', { name: 'Результати' }).click();
    await t.getByTestId(`result-${NAMES[0]}`).getByText('100%').waitFor();
    expect(yaryna.errors).toEqual([]);
  });

  it('«після терміну» needs a due date; «Закрити зараз» opens the review and closes it', async () => {
    await t.getByRole('button', { name: 'Налаштування' }).click();
    const dlg = t.getByRole('dialog', { name: 'Налаштування завдання' });
    await dlg.getByLabel('Правильні відповіді учням').selectOption({ label: 'Після терміну' });
    await dlg.getByLabel('Виконати до').fill('');
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await dlg.getByRole('alert').getByText('вкажіть термін').waitFor();
    await dlg.getByRole('button', { name: 'Закрити зараз' }).click();
    await t.getByText('відповіді учням: після терміну').waitFor();

    // Yaryna now sees her review; Ostap can no longer do the work.
    await yaryna.goto(`${BASE_URL}/`);
    await yaryna.getByTestId('hw-Пристрої').click({ timeout: 15_000 });
    await yaryna.getByTestId('hw-score').getByText('3').waitFor();
    const o = await pupilWithWord(browser, code, NAMES[1]!, pw[1]!);
    opened.push(o.ctx);
    await o.page.getByTestId('hw-Пристрої').getByText('Час вийшов').waitFor();
    await o.page.getByTestId('hw-Пристрої').click();
    await o.page.getByText('Час на виконання цього завдання минув.').waitFor();
    expect([...yaryna.errors, ...o.page.errors]).toEqual([]);
  });

  it('a due date is entered and shown in Kyiv time', async () => {
    await t.getByRole('button', { name: 'Налаштування' }).click();
    const dlg = t.getByRole('dialog', { name: 'Налаштування завдання' });
    await dlg.getByLabel('Виконати до').fill('2030-10-01T18:00');
    await dlg.getByRole('button', { name: 'Зберегти' }).click();
    await t.getByText('до 1 жовтня о 18:00').first().waitFor();
    // 18:00 in Kyiv (summer time, UTC+3) is 15:00 UTC in the database.
    const id = t.url().split('/').pop()!;
    const due = (await adminDb().doc(`assignments/${id}`).get()).get('dueAt') as {
      toDate(): Date;
    };
    expect(due.toDate().toISOString()).toBe('2030-10-01T15:00:00.000Z');
  });

  it('deleting the work removes it from the journal', async () => {
    await t.getByRole('button', { name: 'Видалити' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Видалити' }).click();
    await t.getByRole('tab', { name: 'Журнал' }).click();
    await t
      .getByTestId('journal')
      .waitFor({ state: 'detached', timeout: 5_000 })
      .catch(() => {});
    expect(await t.getByText('Пристрої').count()).toBe(0);
    expect(t.errors).toEqual([]);
  });
});

describe('lesson console: the remaining buttons', () => {
  let pcA: TrackedPage;
  let pcB: TrackedPage;
  let pcG: TrackedPage;
  let ctxA: BrowserContext;

  const send = async () => {
    await t.getByRole('button', { name: 'Надіслати', exact: true }).click();
    await t
      .locator('.panel-send')
      .getByText(/^Надіслано о/)
      .waitFor();
  };

  it('a senior class: theme «Старші», three PCs, «вибрати всіх онлайн»', async () => {
    const code = await createClass(t, '7-Л', 7);
    await addStudents(t, ['Аліна', 'Богдан']);
    const [wa, wb] = await words(t, ['Аліна', 'Богдан']);
    await t.goto(`${BASE_URL}/t/lesson`);
    await t.getByLabel('Новий клас').selectOption({ label: '7-Л' });
    await t.locator('.panel-class').getByRole('button', { name: 'Почати урок' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Почати урок' }).click();
    await t.getByTestId('lesson-class').getByText('7-Л').waitFor();
    expect(code).toMatch(/^\d{6}$/);

    const login = async (name: string, word: string, pc: string) => {
      const ctx = await computer(browser);
      opened.push(ctx);
      const p = await open(ctx, '/');
      await p.getByRole('button', { name: 'Я на уроці: 7-Л' }).click({ timeout: 15_000 });
      await p.getByRole('button', { name }).click();
      await p.getByLabel('Пароль').fill(word);
      await p.getByRole('button', { name: 'Увійти' }).click();
      await p.getByLabel("Номер комп'ютера").fill(pc);
      await p.getByRole('button', { name: 'Готово' }).click();
      await p.getByTestId('lesson-screen').waitFor();
      return { ctx, p };
    };
    const a = await login('Аліна', wa!, '1');
    pcA = a.p;
    ctxA = a.ctx;
    pcB = (await login('Богдан', wb!, '2')).p;
    const g = await computer(browser);
    opened.push(g);
    pcG = await open(g, '/');
    await pcG.getByRole('button', { name: /Увійти як гість/ }).click({ timeout: 15_000 });
    await pcG.getByLabel("Номер комп'ютера").fill('3');
    await pcG.getByLabel("Ім'я та прізвище").fill('Гість Три');
    await pcG.getByRole('button', { name: 'Готово' }).click();
    await pcG.getByTestId('lesson-screen').waitFor();

    // Grades 7–9 get the «Старші» look by default.
    await pcA.locator('.student.theme-senior').waitFor();
    await t.getByRole('radio', { name: 'Молодші' }).click();
    await pcA.locator('.student.theme-junior').waitFor();
    await t.getByRole('radio', { name: 'Старші' }).click();
    await pcA.locator('.student.theme-senior').waitFor();

    await t.getByTestId('online-count').getByText('онлайн: 3 з 3').waitFor();
    await t.getByRole('button', { name: 'вибрати всіх онлайн' }).click();
    await t.getByLabel('вибраним (3)').waitFor();
    await t.locator('[data-pc="pc03"]').click();
    await t.getByLabel('вибраним (2)').waitFor();
    expect(t.errors).toEqual([]);
  });

  it('a message only to the selected; «Прибрати з екранів»', async () => {
    await t.getByLabel('вибраним (2)').check();
    await t.getByRole('radio', { name: 'Повідомлення' }).click();
    await t.getByLabel('Текст повідомлення').fill('Тільки для ПК 1 і 2');
    await send();
    await pcA.getByText('Тільки для ПК 1 і 2').waitFor();
    await pcB.getByText('Тільки для ПК 1 і 2').waitFor();
    await pcG.waitForTimeout(800);
    expect(await pcG.getByText('Тільки для ПК 1 і 2').count()).toBe(0);
    await t.getByText('Кому: ПК 01, ПК 02').waitFor();

    await t.getByRole('button', { name: 'Прибрати з екранів' }).click();
    await pcA.getByText('Чекаємо на завдання').waitFor();
    await pcB.getByText('Чекаємо на завдання').waitFor();
    await t.getByText('Зараз на екранах нічого немає.').waitFor();
    await t.getByRole('button', { name: 'зняти вибір' }).first().click();
  });

  it('timer: own minutes, «+1 хв», «Стоп»; hands: «опустити всі»', async () => {
    await t.getByLabel('Хвилин').fill('0');
    await t.getByRole('button', { name: 'Старт' }).click();
    await t.getByText('Таймер: від 1 до 120 хвилин.').waitFor();
    await t.getByLabel('Хвилин').fill('2');
    await t.getByRole('button', { name: 'Старт' }).click();
    await pcA
      .getByTestId('timer')
      .getByText(/^01:5\d|^02:00/)
      .waitFor();
    await t.getByRole('button', { name: '+1 хв' }).click();
    await pcA
      .getByTestId('timer')
      .getByText(/^02:5\d|^03:00/)
      .waitFor();
    await t.getByRole('button', { name: 'Стоп' }).click();
    await pcA.getByTestId('timer').waitFor({ state: 'detached' });

    await pcA.getByRole('button', { name: 'Підняти руку' }).click();
    await pcB.getByRole('button', { name: 'Підняти руку' }).click();
    await t
      .getByTestId('hands')
      .getByText(/ПК 02 · Богдан/)
      .waitFor();
    await t.getByRole('button', { name: 'опустити всі' }).click();
    await pcA.getByRole('button', { name: 'Підняти руку' }).waitFor();
    await pcB.getByRole('button', { name: 'Підняти руку' }).waitFor();
    expect(await t.getByTestId('hands').count()).toBe(0);
  });

  it('a test: «Правильні відповіді» for the teacher, «це не я» on a PC', async () => {
    await t.getByRole('radio', { name: 'Тест' }).click();
    const option = t.locator('.panel-send select option', { hasText: /^Пристрої \(/ });
    await t.locator('.panel-send select').selectOption((await option.getAttribute('value'))!);
    await send();
    await t.getByText('Правильні відповіді', { exact: true }).click();
    await t.locator('.panel-now').getByText('процесор / ЦП').waitFor();

    await pcB.getByRole('button', { name: 'це не я' }).click();
    await pcB
      .getByRole('alertdialog')
      .getByRole('button', { name: /Вийти|Так/ })
      .click();
    await pcB.getByRole('button', { name: 'Аліна' }).waitFor({ timeout: 15_000 });
    expect([...pcA.errors, ...pcB.errors, ...pcG.errors, ...t.errors]).toEqual([]);
  });

  it('a PC without network: «Немає зв’язку…», then a message sent meanwhile arrives', async () => {
    await ctxA.setOffline(true);
    await pcA.getByRole('alert').getByText('Немає зв’язку…').waitFor({ timeout: 15_000 });
    await t.getByRole('radio', { name: 'Повідомлення' }).click();
    await t.getByLabel('Текст повідомлення').fill('Поки тебе не було');
    await send();
    await ctxA.setOffline(false);
    await pcA.getByText('Поки тебе не було').waitFor({ timeout: 20_000 });
    await pcA.getByText('Немає зв’язку…').waitFor({ state: 'detached', timeout: 15_000 });
    expect(pcA.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|network/i.test(e))).toEqual([]);

    await t.getByRole('button', { name: 'Завершити урок' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Завершити урок' }).click();
    await t.getByTestId('lesson-class').getByText('не обрано').waitFor();
  });
});

const openGame = async (classPath: string) => {
  await t.goto(`${BASE_URL}/t`);
  await t.getByRole('link', { name: new RegExp(classPath) }).click();
  await t.getByRole('tab', { name: 'Завдання' }).click();
  await t.getByRole('button', { name: 'Жива гра' }).click();
  const dlg = t.getByRole('dialog', { name: 'Жива гра' });
  await dlg.getByLabel('Тест').selectOption({ label: 'Пристрої (3 питання)' });
  await dlg.getByRole('button', { name: 'Відкрити гру' }).click();
  await t.getByTestId('game-host').waitFor();
};
const join = async (p: TrackedPage) => {
  await p.goto(`${BASE_URL}/`);
  await p.getByRole('button', { name: /Приєднатися до гри/ }).click({ timeout: 15_000 });
  await p.getByText('Чекаємо, коли вчитель почне гру').waitFor();
};

describe('live game variants', () => {
  it('grades 2–4: «Прочитати», 100 points, no rating; a word, several answers, time out', async () => {
    const code = await createClass(t, '3-К', 3);
    await addStudents(t, ['Марійка', 'Денис']);
    const pm = await pictures(t, 'Марійка');
    const pd = await pictures(t, 'Денис');
    const m = await pupilWithPictures(browser, code, 'Марійка', pm);
    const d = await pupilWithPictures(browser, code, 'Денис', pd);
    opened.push(m.ctx, d.ctx);

    // Homework of a junior class reads questions aloud.
    await t.getByRole('tab', { name: 'Завдання' }).click();
    await t.getByRole('button', { name: 'Дати завдання' }).click();
    const dlg = t.getByRole('dialog', { name: 'Дати завдання' });
    await dlg.getByLabel('Тест').selectOption({ label: 'Пристрої (3 питання)' });
    await dlg.getByRole('button', { name: 'Видати завдання' }).click();
    await t
      .getByRole('dialog', { name: 'Завдання видано' })
      .getByRole('button', { name: 'Готово' })
      .click();
    await m.page.getByTestId('hw-Пристрої').click({ timeout: 15_000 });
    await m.page.getByRole('button', { name: 'Почати' }).click();
    await m.page.getByRole('button', { name: 'Прочитати' }).click();
    await m.page.waitForTimeout(300);
    expect(m.page.errors).toEqual([]);

    await openGame('3-К');
    await join(m.page);
    await join(d.page);
    await t.getByTestId('joined-count').getByText('2').waitFor();
    await t.getByRole('button', { name: 'Почати гру' }).click();

    // Q1: one right, one wrong → everyone answered → the answer is shown.
    await m.page.getByRole('radio', { name: 'Клавіатура' }).click();
    await d.page.getByRole('radio', { name: 'Монітор' }).click();
    await m.page.getByTestId('game-reveal').getByText('Правильно! +100').waitFor();
    await d.page.getByTestId('game-reveal').getByText('Неправильно').waitFor();
    expect(await t.getByTestId('leaderboard').count()).toBe(0);

    // Q2: a word (the second spelling counts); Денис doesn't answer.
    await t.getByRole('button', { name: 'Наступне питання →' }).click();
    await m.page.getByLabel('Відповідь').fill('цп');
    await m.page.getByRole('button', { name: 'Відповісти' }).click();
    await m.page.getByTestId('answer-accepted').waitFor();
    await t.getByRole('button', { name: 'Показати відповідь' }).click();
    await d.page.getByText('Ти не встиг(ла) відповісти').waitFor();
    await m.page.getByTestId('game-reveal').getByText('Правильно! +100').waitFor();

    // Q3: several answers, 10 s; Денис again silent → the time runs out by itself.
    await t.getByRole('button', { name: 'Наступне питання →' }).click();
    await m.page.getByRole('checkbox', { name: 'Монітор' }).click();
    await m.page.getByRole('checkbox', { name: 'Принтер' }).click();
    await m.page.getByRole('button', { name: 'Відповісти' }).click();
    await m.page.getByTestId('answer-accepted').waitFor();
    await d.page.getByTestId('game-reveal').waitFor({ timeout: 20_000 });
    await t.getByRole('button', { name: 'Підсумки' }).click();
    await t.getByText('Молодці! Усі старалися.').waitFor();
    await m.page.getByText('Правильних відповідей: 3 з 3').waitFor();
    await m.page.getByText('Молодець! Дякуємо за гру.').waitFor();

    await t.getByRole('link', { name: 'Відкрити журнал' }).click();
    await t.getByTestId('journal-Марійка').getByText('100%').waitFor();
    await t.getByTestId('journal-Денис').getByText('0%').waitFor();
    expect([...m.page.errors, ...d.page.errors, ...t.errors]).toEqual([]);
  });

  it('ended early: only the asked question counts; ended in the lobby: nothing', async () => {
    const code7 = await createClass(t, '7-Г', 7);
    await addStudents(t, ['Ірина']);
    const [wi] = await words(t, ['Ірина']);
    const p = await pupilWithWord(browser, code7, 'Ірина', wi!);
    opened.push(p.ctx);

    await openGame('7-Г');
    await join(p.page);
    await t.getByRole('button', { name: 'Почати гру' }).click();
    await p.page.getByRole('radio', { name: 'Клавіатура' }).click();
    await p.page.getByTestId('game-reveal').waitFor();
    await t.getByRole('button', { name: 'Завершити' }).click();
    await t.getByRole('alertdialog').getByText('Результати збережуться в журнал класу.').waitFor();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Завершити' }).click();
    await t.getByTestId('game-finished').waitFor();
    await p.page.getByText('Правильних відповідей: 1 з 1').waitFor();

    await openGame('7-Г');
    await t.getByRole('button', { name: 'Завершити' }).click();
    await t.getByRole('alertdialog').getByText('Гра ще не почалася').waitFor();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Завершити' }).click();
    await t.getByText('Гра не почалася — у журнал нічого не потрапило.').waitFor();

    await t.getByRole('link', { name: 'Відкрити журнал' }).click();
    await t.getByTestId('journal-Ірина').getByText('100%').waitFor();
    expect(await t.getByTestId('journal').getByText('(гра)').count()).toBe(1);
    expect([...p.page.errors, ...t.errors]).toEqual([]);
  });
});

describe('live game: joining by the game code', () => {
  it('a pupil types the code; another joins by the QR link after the start', async () => {
    const code = await createClass(t, '8-К', 8);
    await addStudents(t, ['Кіра', 'Лука']);
    const [wk, wl] = await words(t, ['Кіра', 'Лука']);
    expect(code).toMatch(/^\d{6}$/);
    await openGame('8-К');
    const pin = (await t.getByTestId('game-pin').textContent())!.replace(/\s/g, '');
    expect(pin).toMatch(/^\d{6}$/);
    await t.getByRole('img', { name: /QR-код для входу в гру/ }).waitFor();

    // Кіра: the start page → «Увійти в гру за кодом» → name → password → the lobby.
    const k = await computer(browser);
    opened.push(k);
    const kp = await open(k, '/');
    await kp.getByRole('button', { name: 'Увійти в гру за кодом' }).click({ timeout: 15_000 });
    await kp.getByLabel('Код гри').fill('000000');
    await kp.getByRole('button', { name: 'До гри' }).click();
    await kp.getByRole('alert').getByText('Гру з таким кодом не знайдено').waitFor();
    await kp.getByLabel('Код гри').fill(pin);
    await kp.getByRole('button', { name: 'До гри' }).click();
    await kp.getByTestId('game-join-badge').waitFor();
    await kp.getByRole('button', { name: 'Кіра' }).click();
    await kp.getByLabel('Пароль').fill(wk!);
    await kp.getByRole('button', { name: 'Увійти' }).click();
    await kp.getByText('Чекаємо, коли вчитель почне гру').waitFor({ timeout: 15_000 });
    await t.getByTestId('joined-count').getByText('1').waitFor();

    await t.getByRole('button', { name: 'Почати гру' }).click();
    await t.getByTestId('game-pin-chip').getByText(pin.slice(0, 3)).waitFor();

    // Лука is late: the QR link on a phone, straight into the running question.
    const l = await computer(browser, { width: 375, height: 740 });
    opened.push(l);
    const lp = await open(l, `/g/${pin}`);
    await lp.getByRole('button', { name: 'Лука' }).click({ timeout: 15_000 });
    await lp.getByLabel('Пароль').fill(wl!);
    await lp.getByRole('button', { name: 'Увійти' }).click();
    await lp.getByRole('radio', { name: 'Клавіатура' }).click({ timeout: 15_000 });
    await lp.getByTestId('answer-accepted').or(lp.getByTestId('game-reveal')).waitFor();
    await t
      .getByTestId('answered')
      .getByText(/1\/2|2\/2/)
      .waitFor();

    // A pupil of another class who follows the link is told so.
    const other = await createClass(t, '8-Ж', 8);
    await addStudents(t, ['Марк']);
    const [wm] = await words(t, ['Марк']);
    const m = await pupilWithWord(browser, other, 'Марк', wm!);
    opened.push(m.ctx);
    await m.page.goto(`${BASE_URL}/g/${pin}`);
    await m.page.getByText('Ця гра — для іншого класу').waitFor({ timeout: 30_000 });

    // After the game the code no longer works.
    await t.goto(`${BASE_URL}/t`);
    await t.getByRole('link', { name: /8-К/ }).click();
    await t.getByRole('tab', { name: 'Завдання' }).click();
    const gameUrl = (await adminDb().collection('gamePins').doc(pin).get()).get('gameId') as string;
    await t.goto(`${BASE_URL}/t/game/${gameUrl}`);
    await t.getByRole('button', { name: 'Завершити' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Завершити' }).click();
    await t.getByTestId('game-finished').waitFor();
    await expect
      .poll(async () => (await adminDb().collection('gamePins').doc(pin).get()).exists)
      .toBe(false);
    expect([...kp.errors, ...lp.errors, ...m.page.errors]).toEqual([]);
  });
});

describe('bad network', () => {
  it('homework sent without network goes out when the network is back', async () => {
    const code = await createClass(t, '6-О', 6);
    await addStudents(t, ['Олег']);
    const [w] = await words(t, ['Олег']);
    await t.getByRole('tab', { name: 'Завдання' }).click();
    await t.getByRole('button', { name: 'Дати завдання' }).click();
    const dlg = t.getByRole('dialog', { name: 'Дати завдання' });
    await dlg.getByLabel('Тест').selectOption({ label: 'Пристрої (3 питання)' });
    await dlg.getByRole('button', { name: 'Видати завдання' }).click();
    await t
      .getByRole('dialog', { name: 'Завдання видано' })
      .getByRole('button', { name: 'Готово' })
      .click();

    const o = await pupilWithWord(browser, code, 'Олег', w!, { width: 375, height: 740 });
    opened.push(o.ctx);
    await o.page.getByTestId('hw-Пристрої').click();
    await o.page.getByRole('button', { name: 'Почати' }).click();
    await o.page.getByRole('radio', { name: 'Клавіатура' }).click();
    await o.ctx.setOffline(true);
    await o.page.getByRole('button', { name: 'Далі →' }).click();
    await o.page.getByLabel('Відповідь').fill('процесор');
    await o.page.getByRole('button', { name: 'Далі →' }).click();
    await o.page.getByRole('checkbox', { name: 'Монітор' }).click();
    await o.page.getByRole('button', { name: 'Завершити' }).click();
    await o.page.getByRole('button', { name: 'Надіслати' }).click();
    await o.page.waitForTimeout(2000);
    expect(await o.page.getByTestId('hw-result').count()).toBe(0);
    await o.ctx.setOffline(false);
    await o.page.getByTestId('hw-score').getByText('2').waitFor({ timeout: 30_000 });

    await t.getByTestId('work-Пристрої').getByRole('link', { name: 'Результати' }).click();
    await t.getByTestId('result-Олег').getByText('67%').waitFor();
    expect(o.page.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|network/i.test(e))).toEqual([]);
  });

  it('slow internet and a slow PC: the pupil page is ready within 15 s', async () => {
    const ctx = await computer(browser);
    opened.push(ctx);
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.enable');
    // ~1.5 Mbit/s, 300 ms round trip (a busy school Wi-Fi); a PC 4× slower than this one.
    await cdp.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 300,
      downloadThroughput: 190_000,
      uploadThroughput: 90_000,
    });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const t0 = Date.now();
    await page.goto(`${BASE_URL}/`);
    await page.getByRole('heading', { name: 'Введи код класу' }).waitFor({ timeout: 30_000 });
    const ms = Date.now() - t0;
    process.stdout.write(`\n[measure] pupil page on slow internet + slow PC: ${ms} ms\n`);
    expect(ms).toBeLessThan(15_000);
  });
});

describe('load: a class of 30', () => {
  const N = 30;
  const names = Array.from({ length: N }, (_, i) => `Учень ${String(i + 1).padStart(2, '0')}`);
  let pupils: VirtualPupil[] = [];

  beforeAll(async () => {
    await createClass(t, '9-Н', 9);
    await addStudents(t, names);
    const classId = new URL(t.url()).pathname.split('/').pop()!;
    // The list on screen appears before the server has it: wait for all 30 there.
    const query = adminDb().collection('studentSecrets').where('classId', '==', classId);
    for (let i = 0; i < 60 && (await query.get()).size < N; i++) await t.waitForTimeout(250);
    const secrets = await query.get();
    pupils = secrets.docs.map((d) => new VirtualPupil(d.id, classId, d.get('secret') as string));
    await Promise.all(pupils.map((p) => p.login()));
  });

  afterAll(async () => {
    await Promise.all(pupils.map((p) => p.close()));
  });

  it('live game: 30 answers at once reach the projector; counts and top-5 are right', async () => {
    await openGame('9-Н');
    const gameId = t.url().split('/').pop()!;
    await Promise.all(
      pupils.map((p) =>
        setDoc(doc(p.db, 'games', gameId, 'players', p.studentId), { joinedAt: serverTimestamp() }),
      ),
    );
    await t.getByTestId('joined-count').getByText(String(N)).waitFor({ timeout: 20_000 });

    // Each pupil answers as soon as the question appears: option i % 3.
    const chosen = new Map<string, number>();
    const answered = pupils.map((p, i) =>
      p
        .waitFor(`games/${gameId}`, (g) =>
          g?.status === 'question' && g.index === 0
            ? (g.questions as { options: { id: string }[] }[])[0]!.options
            : null,
        )
        .then(async (options) => {
          const value = options[i % options.length]!.id;
          chosen.set(value, (chosen.get(value) ?? 0) + 1);
          const t0 = Date.now();
          await setDoc(doc(p.db, 'games', gameId, 'answers', `${p.studentId}_0`), {
            studentId: p.studentId,
            index: 0,
            value,
            at: serverTimestamp(),
          });
          return Date.now() - t0;
        }),
    );
    const start = Date.now();
    await t.getByRole('button', { name: 'Почати гру' }).click();
    const writes = await Promise.all(answered);
    await t.getByTestId('leaderboard').waitFor({ timeout: 20_000 });
    const total = Date.now() - start;
    process.stdout.write(
      `\n[measure] game, ${N} pupils: start → all answered → answer shown ${total} ms; ` +
        `one answer write ≤ ${Math.max(...writes)} ms\n`,
    );
    expect(await t.getByTestId('answered').textContent()).toBe(`${N}/${N}`);
    for (const [id, count] of chosen) {
      expect(await t.getByTestId(`count-${id}`).textContent()).toContain(String(count));
    }
    expect(await t.locator('.leader').count()).toBe(5);
    expect(total).toBeLessThan(10_000);
    expect(t.errors).toEqual([]);
  });

  it('lesson: 30 PCs online, a link reaches all of them within 2 s', async () => {
    await t.goto(`${BASE_URL}/t/lesson`);
    await t.getByLabel('Новий клас').selectOption({ label: '9-Н' });
    await t.locator('.panel-class').getByRole('button', { name: 'Почати урок' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Почати урок' }).click();
    await t.getByTestId('lesson-class').getByText('9-Н').waitFor();
    // A pupil needs seconds to log in; «Почати урок» clears the old cards meanwhile.
    await t.waitForTimeout(1000);
    await Promise.all(
      pupils.map((p, i) => {
        const pc = `pc${String(i + 1).padStart(2, '0')}`;
        return setDoc(doc(p.db, 'rooms', 'lab', 'pcs', pc), {
          pc,
          num: i + 1,
          name: names[i],
          studentId: p.studentId,
          lastSeen: serverTimestamp(),
        });
      }),
    );
    await t
      .getByTestId('online-count')
      .getByText(`онлайн: ${N} з ${N}`)
      .waitFor({ timeout: 20_000 });

    const got = pupils.map((p) =>
      p.waitFor('rooms/lab', (r) => {
        const task = r?.task as { url?: string } | null | undefined;
        return task?.url?.includes('example.com/load') ? Date.now() : null;
      }),
    );
    await t.getByRole('radio', { name: 'Посилання' }).click();
    await t.getByLabel('Адреса', { exact: true }).fill('example.com/load');
    const t0 = Date.now();
    await t.getByRole('button', { name: 'Надіслати', exact: true }).click();
    const arrived = (await Promise.all(got)).map((ms) => ms - t0);
    process.stdout.write(
      `\n[measure] lesson, ${N} PCs: link on every PC in ≤ ${Math.max(...arrived)} ms\n`,
    );
    expect(Math.max(...arrived)).toBeLessThan(2000);

    await t.getByRole('button', { name: 'Завершити урок' }).click();
    await t.getByRole('alertdialog').getByRole('button', { name: 'Завершити урок' }).click();
    await t.getByTestId('lesson-class').getByText('не обрано').waitFor();
    expect(t.errors).toEqual([]);
  });
});

describe('accessibility (axe, WCAG 2 A/AA)', () => {
  const AXE = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  const found: string[] = [];

  const audit = async (page: TrackedPage, name: string) => {
    await page.addScriptTag({ content: AXE });
    const res = (await page.evaluate(() =>
      (
        window as unknown as {
          axe: { run: (o: unknown) => Promise<{ violations: unknown[] }> };
        }
      ).axe.run({ runOnly: ['wcag2a', 'wcag2aa'] }),
    )) as {
      violations: {
        id: string;
        impact: string;
        help: string;
        nodes: { target: string[]; any: { message: string }[] }[];
      }[];
    };
    for (const v of res.violations) {
      found.push(
        `${name}: [${v.impact}] ${v.id} — ${v.help} (${v.nodes.length}: ${v.nodes
          .slice(0, 3)
          .map((n) => n.target.join(' '))
          .join(', ')}) ${v.nodes[0]?.any[0]?.message ?? ''}`,
      );
    }
  };

  afterAll(() => {
    process.stdout.write(`\n[axe] ${found.length ? `\n${found.join('\n')}` : 'no violations'}\n`);
  });

  it('teacher screens', async () => {
    for (const [path, ready] of [
      ['/t', 'Мої класи'],
      ['/t/quizzes', 'Банк тестів'],
      ['/t/lesson', 'Урок'],
      ['/t/history', 'Історія тестів'],
    ] as const) {
      await t.goto(`${BASE_URL}${path}`);
      await t.getByRole('heading', { name: ready }).first().waitFor();
      await audit(t, path);
    }
    // Each cabinet theme on the home page.
    for (const theme of ['Тепла', 'Темна', 'Світла']) {
      await t.goto(`${BASE_URL}/t`);
      await t.getByRole('radio', { name: theme }).click();
      await t.getByRole('heading', { name: 'Мої класи' }).waitFor();
      await audit(t, `головна (${theme})`);
    }
    await t.goto(`${BASE_URL}/t`);
    await t.getByRole('link', { name: /6-О/ }).click();
    await t.getByRole('heading', { name: 'Клас 6-О' }).waitFor();
    await audit(t, 'клас');
    await t.getByRole('tab', { name: 'Журнал' }).click();
    await t.getByTestId('journal').waitFor();
    await audit(t, 'журнал');
    await t.goto(`${BASE_URL}/t/quizzes`);
    await t.getByTestId('quiz-Пристрої').getByRole('link', { name: 'Редагувати' }).click();
    await t.getByLabel('Назва тесту').waitFor();
    await audit(t, 'редактор');
  });

  it('pupil screens', async () => {
    const ctx = await computer(browser, { width: 375, height: 740 });
    opened.push(ctx);
    const p = await open(ctx, '/');
    await p.getByRole('heading', { name: 'Введи код класу' }).waitFor({ timeout: 15_000 });
    await audit(p, 'учень: код');
    const code = (
      await adminDb().collection('classes').where('name', '==', '3-К').get()
    ).docs[0]!.get('joinCode') as string;
    await p.goto(`${BASE_URL}/join/${code}`);
    await p.getByRole('button', { name: 'Марійка' }).click({ timeout: 15_000 });
    await p.getByText('Натисни свої 4 картинки').waitFor();
    await audit(p, 'учень: картинки');
    const classId = (await adminDb().collection('classes').where('name', '==', '3-К').get())
      .docs[0]!.id;
    const roster = await adminDb().collection(`classes/${classId}/roster`).get();
    const sid = roster.docs.find((d) => d.get('displayName') === 'Марійка')!.id;
    const secret = (await adminDb().doc(`studentSecrets/${sid}`).get()).get('secret') as string;
    for (const id of secret.split('-')) {
      const label = PICTURES.find((x) => x.id === id)!.label;
      await p.getByRole('button', { name: label, exact: true }).click();
    }
    await p.getByRole('heading', { name: 'Привіт, Марійка!' }).waitFor();
    await audit(p, 'учень: головна');
    await p.getByTestId('hw-Пристрої').click();
    await p.getByRole('button', { name: 'Почати' }).click();
    await p.getByRole('radio').first().waitFor();
    await audit(p, 'учень: питання');
  });

  it('no serious or critical problems', () => {
    expect(found.filter((f) => /\[(critical|serious)\]/.test(f))).toEqual([]);
  });
});
