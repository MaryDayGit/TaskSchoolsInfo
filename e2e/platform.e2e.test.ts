/*
 * Сценарии единой платформы в Chromium 109 (версия школьных ПК) на эмуляторах
 * Firebase. Запуск: npm run test:e2e (сам собирает приложение и поднимает эмуляторы).
 * Сценарии идут по порядку и используют общее состояние эмулятора.
 */
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { BASE_URL, computer, launch, open, resetEmulators, type TrackedPage } from './helpers';

let browser: Browser;
let teacherPc: BrowserContext;
let teacher: TrackedPage;
const CODE = '5555';

beforeAll(async () => {
  await resetEmulators();
  browser = await launch();
  teacherPc = await computer(browser);
});

afterAll(async () => {
  await browser?.close();
});

const CLASSES_HEADING = { name: 'Мої класи' };

describe('stage 1: foundation', () => {
  it('runs the school browser version', () => {
    expect(browser.version()).toMatch(/^109\./);
  });

  it('student page opens without errors', async () => {
    const pupil = await computer(browser);
    const page = await open(pupil, '/');
    await page.getByRole('heading', { name: 'Введи код класу' }).waitFor({ timeout: 15_000 });
    expect(page.errors).toEqual([]);
    await pupil.close();
  });

  it('first run: the teacher invents a code', async () => {
    const page = await open(teacherPc, '/t');
    await page.getByText('Перший запуск').waitFor({ timeout: 15_000 });

    await page.getByLabel('Новий код учителя').fill('12');
    await page.getByLabel('Повторіть код').fill('12');
    await page.getByRole('button', { name: 'Зберегти код і відкрити кабінет' }).click();
    await page.getByRole('alert').getByText('щонайменше 4 символи').waitFor();

    await page.getByLabel('Новий код учителя').fill(CODE);
    await page.getByLabel('Повторіть код').fill('5556');
    await page.getByRole('button', { name: 'Зберегти код і відкрити кабінет' }).click();
    await page.getByRole('alert').getByText('Коди не збігаються').waitFor();

    await page.getByLabel('Повторіть код').fill(CODE);
    await page.getByRole('button', { name: 'Зберегти код і відкрити кабінет' }).click();
    await page.getByRole('heading', CLASSES_HEADING).waitFor();
    expect(page.errors).toEqual([]);
    teacher = page;
  });

  it('another computer needs the code; a wrong one is rejected', async () => {
    const other = await computer(browser);
    const page = await open(other, '/t');
    await page.getByLabel('Код учителя').waitFor({ timeout: 15_000 });
    await page.getByLabel('Код учителя').fill('0000');
    await page.getByRole('button', { name: 'Увійти' }).click();
    await page.getByRole('alert').getByText('Неправильний код.').waitFor();
    await page.getByLabel('Код учителя').fill(CODE);
    await page.getByRole('button', { name: 'Увійти' }).click();
    await page.getByRole('heading', CLASSES_HEADING).waitFor();
    expect(page.errors).toEqual([]);
    await other.close();
  });

  it('teacher and student pages in one browser do not sign each other out', async () => {
    const student = await open(teacherPc, '/');
    await student.getByRole('heading', { name: 'Введи код класу' }).waitFor({ timeout: 15_000 });
    const t = await open(teacherPc, '/t');
    await t.getByRole('heading', CLASSES_HEADING).waitFor({ timeout: 15_000 });
    await student.reload();
    await t.reload();
    await t.getByRole('heading', CLASSES_HEADING).waitFor({ timeout: 15_000 });
    expect([...student.errors, ...t.errors]).toEqual([]);
    await student.close();
    await t.close();
  });
});

// ---------------------------------------------------------------------------

async function createClass(name: string, grade: number): Promise<string> {
  await teacher.goto(`${BASE_URL}/t`);
  await teacher.getByRole('button', { name: '+ Новий клас' }).click();
  await teacher.getByLabel('Назва класу').fill(name);
  await teacher.getByLabel('Рік навчання').selectOption(String(grade));
  await teacher.getByRole('button', { name: 'Створити' }).click();
  await teacher.getByRole('heading', { name: `Клас ${name}` }).waitFor();
  const code = (await teacher.getByTestId('join-code').locator('strong').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

async function addStudents(names: string[]) {
  await teacher.getByLabel('Додати учнів').fill(names.join('\n'));
  await teacher.getByRole('button', { name: `Додати (${names.length})` }).click();
  for (const n of names) await teacher.getByTestId(`student-${n}`).waitFor();
}

/** Picture labels of a student's password, as the teacher sees them. */
async function pictureSecret(name: string): Promise<string[]> {
  const row = teacher.getByTestId(`student-${name}`);
  await row.locator('.secret-pictures svg').first().waitFor();
  return row
    .locator('.secret-pictures svg')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
}

async function tapPictures(page: Page, labels: string[]) {
  for (const l of labels) await page.getByRole('button', { name: l, exact: true }).click();
}

describe('stage 2: classes, students, student login', () => {
  let code3 = '';
  let olaPictures: string[] = [];

  it('teacher creates a primary class, adds students, rejects duplicates', async () => {
    code3 = await createClass('3-А', 3);
    await addStudents(['Оля К.', 'Петро М.']);
    await teacher.getByLabel('Додати учнів').fill('Оля К.');
    await teacher.getByRole('button', { name: 'Додати (1)' }).click();
    await teacher.getByRole('alert').getByText('У класі вже є: Оля К.').waitFor();
    await teacher.getByLabel('Додати учнів').fill('');

    await teacher.getByLabel('Показати паролі').check();
    olaPictures = await pictureSecret('Оля К.');
    expect(olaPictures).toHaveLength(4);
    expect(teacher.errors).toEqual([]);
  });

  it('login cards show every student with SVG pictures', async () => {
    await teacher.getByRole('link', { name: 'Картки входу' }).click();
    await teacher.getByTestId('login-card').first().waitFor();
    expect(await teacher.getByTestId('login-card').count()).toBe(2);
    expect(await teacher.locator('.login-card svg').count()).toBe(8);
    await teacher.getByText(`Код класу: ${code3}`).first().waitFor();
    await teacher.getByRole('link', { name: '← До класу' }).click();
    await teacher.getByRole('heading', { name: 'Клас 3-А' }).waitFor();
  });

  it('a pupil logs in with the class code and 4 pictures', async () => {
    const pc = await computer(browser);
    const page = await open(pc, '/');
    await page.getByLabel('Код класу').fill(code3);
    await page.getByRole('button', { name: 'Далі' }).click();
    await page.getByRole('button', { name: 'Оля К.' }).click();
    await page.getByText('Натисни свої 4 картинки').waitFor();

    const wrong =
      olaPictures[0] === 'Кіт' ? ['Пес', 'Пес', 'Пес', 'Пес'] : ['Кіт', 'Кіт', 'Кіт', 'Кіт'];
    await tapPictures(page, wrong);
    await page.getByRole('alert').getByText('Не ті картинки').waitFor();

    await tapPictures(page, olaPictures);
    await page.getByRole('heading', { name: 'Привіт, Оля К.!' }).waitFor();
    await page.getByTestId('student-home').getByText('Клас 3-А').waitFor();

    // The device stays logged in after a reload.
    await page.reload();
    await page.getByTestId('student-home').waitFor({ timeout: 15_000 });
    expect(page.errors).toEqual([]);

    // The teacher sees the device.
    await teacher.getByTestId('student-Оля К.').getByText('1 пристрій').waitFor();

    // A new password logs the device out.
    await teacher
      .getByTestId('student-Оля К.')
      .getByRole('button', { name: 'Новий пароль' })
      .click();
    await teacher.getByRole('alertdialog').getByRole('button', { name: 'Видати новий' }).click();
    await teacher.getByTestId('student-Оля К.').getByText('ще не входив(ла)').waitFor();
    // The open page notices at once, without a reload, and says why.
    await page.getByText('Вчитель видав тобі новий пароль').waitFor({ timeout: 15_000 });
    await page.getByRole('heading', { name: 'Введи код класу' }).waitFor();
    expect(page.errors).toEqual([]);
    await pc.close();
  });

  it('a pupil logs in with pictures on a small phone; the teacher logs the phone out', async () => {
    const petro = await pictureSecret('Петро М.');
    const phone = await computer(browser, { width: 360, height: 740 });
    const page = await open(phone, `/join/${code3}`);
    const noScroll = async (where: string) => {
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, where).toBeLessThanOrEqual(0);
    };
    await page.getByRole('button', { name: 'Петро М.' }).click({ timeout: 15_000 });
    await page.getByRole('button', { name: petro[0], exact: true }).waitFor();
    await noScroll('picture grid at 360px');
    await tapPictures(page, petro);
    await page.getByRole('heading', { name: 'Привіт, Петро М.!' }).waitFor();
    await noScroll('student home at 360px');

    const row = teacher.getByTestId('student-Петро М.');
    await row.getByText('1 пристрій').waitFor();
    await row.getByRole('button', { name: 'Вийти з усіх пристроїв' }).click();
    await teacher.getByRole('alertdialog').getByRole('button', { name: 'Вийти' }).click();
    await row.getByText('ще не входив(ла)').waitFor();
    // Opened by a /join link: the notice stays on the name step, not only on the code step.
    await page.getByRole('button', { name: 'Петро М.' }).waitFor({ timeout: 15_000 });
    await page.getByText('вийшов з твоїх пристроїв').waitFor();
    expect(page.errors).toEqual([]);
    await phone.close();
  });

  it('a middle-school pupil logs in with a word password on a phone via a /join link', async () => {
    const code7 = await createClass('7-Б', 7);
    await addStudents(['Іван Т.']);
    await teacher.getByLabel('Показати паролі').check();
    const word = (await teacher
      .getByTestId('student-Іван Т.')
      .locator('.secret-word')
      .textContent())!.trim();
    expect(word).toMatch(/^\p{L}+\d{2}$/u);

    const phone = await computer(browser, { width: 375, height: 740 });
    const page = await open(phone, `/join/${code7}`);
    await page.getByRole('button', { name: 'Іван Т.' }).click({ timeout: 15_000 });
    await page.getByLabel('Пароль').fill('неправильно11');
    await page.getByRole('button', { name: 'Увійти' }).click();
    await page.getByRole('alert').getByText('Неправильний пароль').waitFor();
    await page.getByLabel('Пароль').fill(`  ${word.toUpperCase()} `);
    await page.getByRole('button', { name: 'Увійти' }).click();
    await page.getByRole('heading', { name: 'Привіт, Іван Т.!' }).waitFor();

    // «Це не я / Вийти» asks in the page and logs out.
    await page.getByRole('button', { name: 'Це не я / Вийти' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Вийти' }).click();
    // The page was opened by a /join link, so it goes straight to the names.
    await page.getByRole('button', { name: 'Іван Т.' }).waitFor();
    // Leaving on purpose is not "the teacher logged you out".
    await page.reload();
    await page.getByRole('button', { name: 'Іван Т.' }).waitFor({ timeout: 15_000 });
    expect(await page.getByText('Вчитель видав тобі новий пароль').count()).toBe(0);
    expect(page.errors).toEqual([]);
    await phone.close();
  });

  it('a guest joins with a PC number and a name', async () => {
    const pc = await computer(browser);
    const page = await open(pc, '/');
    await page.getByRole('button', { name: /Увійти як гість/ }).click();
    await page.getByLabel("Номер комп'ютера").fill('7');
    await page.getByLabel("Ім'я та прізвище").fill('Марко Гість');
    await page.getByRole('button', { name: 'Готово' }).click();
    await page.getByTestId('guest-home').getByText('ПК 07').waitFor();
    await page.reload();
    await page.getByTestId('guest-home').getByText('Марко Гість').waitFor({ timeout: 15_000 });
    expect(page.errors).toEqual([]);
    await pc.close();
  });

  it('a wrong class code is explained', async () => {
    const pc = await computer(browser);
    const page = await open(pc, '/');
    await page.getByLabel('Код класу').fill('000000');
    await page.getByRole('button', { name: 'Далі' }).click();
    await page.getByRole('alert').getByText('Клас з таким кодом не знайдено').waitFor();
    await pc.close();
  });
});

describe('stage 3: bank, homework, results, journal', () => {
  const IMPORT = [
    '# Мережі',
    'Папка: 6 клас',
    "1. Що з'єднує комп'ютери у всьому світі?",
    '* Інтернет',
    '- Принтер',
    '- Монітор',
    '',
    '2. Скільки біт в одному байті?',
    '- 4',
    '* 8',
    '- 10',
  ].join('\n');
  let link = '';
  let word = '';
  let phone: BrowserContext;
  let pupil: TrackedPage;

  it('teacher imports a test from text; errors name the line', async () => {
    await teacher.goto(`${BASE_URL}/t/quizzes`);
    await teacher.getByRole('heading', { name: 'Банк тестів' }).waitFor();
    await teacher.getByRole('button', { name: 'Імпорт' }).click();
    const dialog = teacher.getByRole('dialog', { name: 'Імпорт тестів з тексту' });
    await dialog.getByLabel('Текст тестів').fill('Питання без заголовка');
    await dialog.getByRole('alert').getByText('Рядок 1').waitFor();
    await dialog.getByLabel('Текст тестів').fill(IMPORT);
    await dialog.getByTestId('import-preview').getByText('Мережі').waitFor();
    await dialog.getByRole('button', { name: /^Імпортувати/ }).click();
    const row = teacher.getByTestId('quiz-Мережі');
    await row.getByText('2 питання · ще не давали').waitFor();
    await teacher.getByRole('heading', { name: '6 клас · 1' }).waitFor();

    // «Відповіді» shows the key without editing.
    await row.getByRole('button', { name: 'Відповіді' }).click();
    const key = teacher.getByRole('dialog', { name: 'Відповіді: Мережі' });
    await key.locator('.answer-ok').getByText('Інтернет').waitFor();
    await key.getByRole('button', { name: 'Закрити' }).click();
    expect(teacher.errors).toEqual([]);
  });

  it('teacher adds a word-answer question in the editor', async () => {
    await teacher.getByTestId('quiz-Мережі').getByRole('link', { name: 'Редагувати' }).click();
    await teacher.getByLabel('Назва тесту').waitFor();
    await teacher.getByRole('button', { name: 'Питання з відповіддю словом' }).click();
    await teacher.getByRole('button', { name: 'Зберегти' }).click();
    await teacher.getByRole('alert').getByText('Питання 3: Напишіть текст питання').waitFor();
    const q3 = teacher.getByTestId('question-3');
    await q3.getByLabel('Текст питання').fill('Столиця України?');
    await q3.getByLabel('Правильна відповідь').fill('Київ');
    await teacher.getByRole('button', { name: 'Зберегти' }).click();
    await teacher.getByRole('status').getByText('Збережено').waitFor();
    await teacher.getByRole('button', { name: '← Банк тестів' }).click();
    await teacher.getByTestId('quiz-Мережі').getByText('3 питання').waitFor();
  });

  it('teacher gives it as homework and gets a link for Classroom', async () => {
    await createClass('6-В', 6);
    await addStudents(['Марія С.']);
    await teacher.getByLabel('Показати паролі').check();
    word = (await teacher
      .getByTestId('student-Марія С.')
      .locator('.secret-word')
      .textContent())!.trim();

    await teacher.getByRole('tab', { name: 'Завдання' }).click();
    await teacher.getByRole('button', { name: 'Дати завдання' }).click();
    const dialog = teacher.getByRole('dialog', { name: 'Дати завдання' });
    await dialog.getByLabel('Тест').selectOption({ label: 'Мережі (3 питання)' });
    await dialog.getByLabel('Кількість спроб').selectOption('2');
    await dialog.getByRole('button', { name: 'Видати завдання' }).click();
    const done = teacher.getByRole('dialog', { name: 'Завдання видано' });
    const share = await done
      .getByRole('link', { name: 'Поділитися в Classroom' })
      .getAttribute('href');
    link = new URL(share!).searchParams.get('url')!;
    expect(link).toMatch(/\/join\/\d{6}\?a=/);
    await done.getByRole('button', { name: 'Готово' }).click();
    await teacher.getByTestId('work-Мережі').waitFor();
    expect(teacher.errors).toEqual([]);
  });

  it('a pupil opens the link on a phone, keeps a draft, submits and sees the review', async () => {
    phone = await computer(browser, { width: 375, height: 740 });
    pupil = await open(phone, link.replace(/^https?:\/\/[^/]+/, ''));
    await pupil.getByRole('button', { name: 'Марія С.' }).click({ timeout: 15_000 });
    await pupil.getByLabel('Пароль').fill(word);
    await pupil.getByRole('button', { name: 'Увійти' }).click();
    // The link opens the assignment right after login.
    await pupil.getByRole('heading', { name: 'Мережі' }).waitFor();
    await pupil.getByRole('button', { name: 'Почати' }).click();
    await pupil.getByRole('radio', { name: 'Інтернет' }).click();

    // A reload keeps the draft.
    await pupil.reload();
    await pupil.getByRole('button', { name: 'Почати' }).click({ timeout: 15_000 });
    expect(await pupil.getByRole('radio', { name: 'Інтернет' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    await pupil.getByRole('button', { name: 'Далі →' }).click();
    await pupil.getByRole('radio', { name: '4', exact: true }).click();
    await pupil.getByRole('button', { name: 'Далі →' }).click();
    await pupil.getByLabel('Відповідь').fill('  київ ');
    await pupil.getByRole('button', { name: 'Завершити' }).click();
    await pupil.getByRole('heading', { name: 'Готово?' }).waitFor();
    await pupil.getByRole('button', { name: 'Надіслати' }).click();

    const result = pupil.getByTestId('hw-result');
    expect(await result.getByTestId('hw-score').textContent({ timeout: 15_000 })).toBe('2');
    await result.getByText('Правильна відповідь: 8').waitFor();
    const overflow = await pupil.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await result.getByRole('button', { name: 'До завдань' }).click();
    await pupil.getByTestId('hw-Мережі').getByText('Здано').waitFor();
    expect(pupil.errors).toEqual([]);
  });

  it('teacher sees results, the journal and CSV files', async () => {
    await teacher.getByTestId('work-Мережі').getByRole('link', { name: 'Результати' }).click();
    await teacher.getByTestId('submitted-count').getByText('Здали: 1 з 1').waitFor();
    const row = teacher.getByTestId('result-Марія С.');
    await row.getByText('67%').waitFor();

    const [csv] = await Promise.all([
      teacher.waitForEvent('download'),
      teacher.getByRole('button', { name: 'CSV' }).click(),
    ]);
    const text = readFileSync((await csv.path())!, 'utf8');
    expect(text).toContain('Марія С.;67%;2;3;1;');

    await teacher.getByRole('link', { name: 'Клас 6-В' }).click();
    await teacher.getByRole('tab', { name: 'Журнал' }).click();
    await teacher.getByTestId('journal-Марія С.').getByText('67%').waitFor();
    const [journal] = await Promise.all([
      teacher.waitForEvent('download'),
      teacher.getByRole('button', { name: /Завантажити для Excel/ }).click(),
    ]);
    expect(journal.suggestedFilename()).toBe('Журнал 6-В.csv');
    expect(readFileSync((await journal.path())!, 'utf8')).toBe('﻿Учень;Мережі\r\nМарія С.;67%\r\n');
    expect(teacher.errors).toEqual([]);
  });

  it('the second attempt counts if better; then attempts are over', async () => {
    await pupil.getByTestId('hw-Мережі').click();
    await pupil.getByRole('button', { name: 'Спробувати ще раз' }).click();
    await pupil.getByRole('radio', { name: 'Інтернет' }).click();
    await pupil.getByRole('button', { name: 'Далі →' }).click();
    await pupil.getByRole('radio', { name: '8', exact: true }).click();
    await pupil.getByRole('button', { name: 'Далі →' }).click();
    await pupil.getByLabel('Відповідь').fill('Київ');
    await pupil.getByRole('button', { name: 'Завершити' }).click();
    await pupil.getByRole('button', { name: 'Надіслати' }).click();
    expect(await pupil.getByTestId('hw-score').textContent({ timeout: 15_000 })).toBe('3');
    expect(await pupil.getByRole('button', { name: 'Спробувати ще раз' }).count()).toBe(0);
    expect(pupil.errors).toEqual([]);
    await phone.close();

    await teacher.getByRole('button', { name: 'Оновити' }).click();
    await teacher.getByTestId('journal-Марія С.').getByText('100%').waitFor();
    await teacher.goto(`${BASE_URL}/t/quizzes`);
    await teacher
      .getByTestId('quiz-Мережі')
      .getByText(/давали: 6-В \d\d\.\d\d/)
      .waitFor();
    expect(teacher.errors).toEqual([]);
  });
});

describe('leaving and small screens', () => {
  it('logout uses the in-page dialog and forgets this browser', async () => {
    const page = await open(teacherPc, '/t');
    await page.getByRole('button', { name: 'Вийти' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Вийти з кабінету?' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await page.getByRole('heading', CLASSES_HEADING).waitFor();

    await page.getByRole('button', { name: 'Вийти' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Вийти' }).click();
    await page.getByLabel('Код учителя').waitFor();
    // No native confirm() was used (helpers record native dialogs as errors).
    expect(page.errors).toEqual([]);
  });

  it('old Клас-пульт bookmark /admin.html leads to the cabinet', async () => {
    const page = await open(teacherPc, '/admin.html');
    await page.waitForURL(`${BASE_URL}/t`);
    await page.getByLabel('Код учителя').waitFor();
  });

  it('phone screens have no horizontal scroll', async () => {
    for (const width of [360, 375]) {
      const phone = await computer(browser, { width, height: 740 });
      for (const path of ['/', '/t']) {
        const page = await open(phone, path);
        // Firestore keeps a connection open, so wait for content, not for network idle.
        await page
          .locator(path === '/' ? '.code-input' : '.login input')
          .first()
          .waitFor({ timeout: 15_000 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow, `${path} at ${width}px`).toBeLessThanOrEqual(0);
      }
      await phone.close();
    }
  });
});
