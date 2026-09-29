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
    await page.getByTestId('guest-home').locator('.who-pc-num').getByText('07').waitFor();
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

describe('stage 4: lesson console (Клас-пульт criteria)', () => {
  let lina = '';
  let pc3: TrackedPage;
  let pc7: TrackedPage;
  let pcs: BrowserContext[] = [];

  const lessonPage = async () => {
    await teacher.goto(`${BASE_URL}/t/lesson`);
    await teacher.getByRole('heading', { name: 'Урок' }).waitFor();
  };
  const startClass = async (name: string) => {
    await teacher.getByLabel('Новий клас').selectOption({ label: name });
    await teacher.locator('.panel-class').getByRole('button', { name: 'Почати урок' }).click();
    await teacher.getByRole('alertdialog').getByRole('button', { name: 'Почати урок' }).click();
    await teacher.getByTestId('lesson-class').getByText(name).waitFor();
  };
  /** The option may say «— вже давали цьому класу»: pick it by the test title. */
  const chooseTest = async (title: string) => {
    const option = teacher.locator('.panel-send select option', { hasText: title });
    await teacher.locator('.panel-send select').selectOption((await option.getAttribute('value'))!);
  };
  const send = async () => {
    await teacher.getByRole('button', { name: 'Надіслати', exact: true }).click();
    await teacher
      .locator('.panel-send')
      .getByText(/^Надіслано о/)
      .waitFor();
  };

  it('teacher starts a lesson by choosing a class', async () => {
    await createClass('5-Г', 5);
    await addStudents(['Ліна Б.', 'Тарас Г.']);
    await teacher.getByLabel('Показати паролі').check();
    lina = (await teacher
      .getByTestId('student-Ліна Б.')
      .locator('.secret-word')
      .textContent())!.trim();
    await lessonPage();
    await startClass('5-Г');
    expect(teacher.errors).toEqual([]);
  });

  it('a pupil logs in from the lesson list; a guest joins with a PC number', async () => {
    const a = await computer(browser);
    const b = await computer(browser);
    pcs = [a, b];
    pc3 = await open(a, '/');
    // A PC without a number yet: the lesson is one button away from the code screen.
    await pc3.getByRole('button', { name: 'Я на уроці: 5-Г' }).click({ timeout: 15_000 });
    await pc3.getByRole('button', { name: 'Ліна Б.' }).click();
    await pc3.getByLabel('Пароль').fill(lina);
    await pc3.getByRole('button', { name: 'Увійти' }).click();
    await pc3.getByLabel("Номер комп'ютера").fill('3');
    await pc3.getByRole('button', { name: 'Готово' }).click();
    await pc3.getByTestId('lesson-screen').getByText('03').waitFor();

    pc7 = await open(b, '/');
    await pc7.getByRole('button', { name: /Увійти як гість/ }).click({ timeout: 15_000 });
    await pc7.getByLabel("Номер комп'ютера").fill('7');
    await pc7.getByLabel("Ім'я та прізвище").fill('Марко Гість');
    await pc7.getByRole('button', { name: 'Готово' }).click();
    await pc7.getByTestId('lesson-screen').getByText('Марко Гість').waitFor();

    await teacher.locator('[data-pc="pc03"]').getByText('Ліна Б.').waitFor();
    await teacher.locator('[data-pc="pc07"]').getByText('гість').waitFor();
    await teacher.getByTestId('online-count').getByText('онлайн: 2 з 2').waitFor();
    expect([...pc3.errors, ...pc7.errors]).toEqual([]);
  });

  it('a link to PC 03 only appears there within 2 seconds, not on PC 07', async () => {
    await teacher.locator('[data-pc="pc03"]').click();
    await teacher.getByLabel('вибраним (1)').waitFor();
    await teacher.getByRole('radio', { name: 'Посилання' }).click();
    await teacher.getByLabel('Адреса', { exact: true }).fill('example.com/lesson');
    await teacher.getByLabel('Назва (необов’язково)').fill('Сайт уроку');
    const t0 = Date.now();
    await send();
    await pc3.getByTestId('task-card').getByText('Сайт уроку').waitFor({ timeout: 5000 });
    const ms = Date.now() - t0;
    expect(ms).toBeLessThan(2000);
    await pc7.waitForTimeout(1000);
    expect(await pc7.getByTestId('task-card').count()).toBe(0);
    await pc7.getByText('Чекаємо на завдання').waitFor();

    const [tab] = await Promise.all([
      pcs[0]!.waitForEvent('page'),
      pc3.getByRole('button', { name: 'Відкрити' }).click(),
    ]);
    await tab.close();
    await pc3.getByText('Відкрито в новій вкладці').waitFor();
    await teacher.locator('[data-pc="pc03"]').getByText('відкрив(ла)').waitFor();
    await teacher.getByRole('button', { name: 'зняти вибір' }).first().click();
  });

  it('message, «Я закінчив(ла)», a raised hand and the lock', async () => {
    await teacher.getByRole('radio', { name: 'Повідомлення' }).click();
    await teacher.getByLabel('Текст повідомлення').fill('Відкрийте зошити');
    await send();
    await pc7.getByText('Відкрийте зошити').waitFor();
    await pc7.getByRole('button', { name: 'Я закінчив(ла)' }).click();
    await teacher.locator('[data-pc="pc07"]').getByText('закінчив(ла)').waitFor();
    await teacher.getByTestId('progress').getByText('Закінчили: 1 з 2').waitFor();

    await pc7.getByRole('button', { name: 'Підняти руку' }).click();
    await teacher
      .getByTestId('hands')
      .getByText(/ПК 07 · Марко Гість/)
      .waitFor();
    await teacher.getByTitle('Опустити руку').click();
    await pc7.getByRole('button', { name: 'Підняти руку' }).waitFor();

    await teacher.getByLabel('Заблокувати екрани').check();
    await pc3.getByRole('alert').getByText('Дивимось на дошку').waitFor();
    await pc7.getByRole('alert').getByText('Дивимось на дошку').waitFor();
    await teacher.getByLabel('Заблокувати екрани').uncheck();
    await pc3.getByText('Дивимось на дошку').waitFor({ state: 'detached' });
    expect([...pc3.errors, ...pc7.errors, ...teacher.errors]).toEqual([]);
  });

  it('a test: the right score, the review, CSV with Cyrillic and the journal', async () => {
    await teacher.getByRole('radio', { name: 'Тест' }).click();
    await chooseTest('Мережі');
    await send();

    await pc3.getByRole('button', { name: 'Почати тест' }).click();
    await pc3.getByRole('radio', { name: 'Інтернет' }).click();
    await pc3.getByRole('radio', { name: '8', exact: true }).click();
    await pc3.getByLabel('Відповідь').fill('Київ');
    await pc3.getByRole('button', { name: 'Надіслати відповіді' }).click();
    await pc3.getByTestId('test-done').waitFor();

    await pc7.getByRole('button', { name: 'Почати тест' }).click();
    await pc7.getByRole('radio', { name: 'Інтернет' }).click();
    await pc7.getByTestId('test-left').getByText('Без відповіді: 2').waitFor();
    await pc7.getByRole('button', { name: 'Надіслати відповіді' }).click();
    await pc7.getByRole('alertdialog').getByRole('button', { name: 'Надіслати' }).click();
    await pc7.getByTestId('test-done').waitFor();

    await teacher.getByTestId('lr-Ліна Б.').getByText('3 / 3').waitFor();
    await teacher.getByTestId('lr-Марко Гість').getByText('1 / 3').waitFor();
    await teacher.getByTestId('progress').getByText('Здали: 2 з 2').waitFor();
    const [csv] = await Promise.all([
      teacher.waitForEvent('download'),
      teacher.getByRole('button', { name: 'Завантажити CSV' }).click(),
    ]);
    expect(csv.suggestedFilename()).toMatch(/^Мережі 5-Г \d\d\.\d\d\.csv$/);
    const text = readFileSync((await csv.path())!, 'utf8');
    expect(text.startsWith('\uFEFFПК;Учень;Бал')).toBe(true);
    expect(text).toContain('03;Ліна Б.;3;3;100%');
    expect(text).toContain('07;Марко Гість;1;3;33%');

    await teacher.getByRole('button', { name: 'Показати учням результати' }).click();
    await pc3.getByTestId('lesson-review').getByText('Твій результат: 3 з 3').waitFor();
    await pc7.getByTestId('lesson-review').getByText('Твій результат: 1 з 3').waitFor();
    expect([...pc3.errors, ...pc7.errors]).toEqual([]);

    // The pupil's result is in the class journal; the guest's is not.
    await teacher.goto(`${BASE_URL}/t`);
    await teacher.getByRole('link', { name: /5-Г/ }).click();
    await teacher.getByRole('tab', { name: 'Журнал' }).click();
    await teacher.getByTestId('journal-Ліна Б.').getByText('100%').waitFor();
    expect(await teacher.getByTestId('journal').getByText('Марко Гість').count()).toBe(0);
    await lessonPage();
  });

  it('the timer matches on a PC whose clock is 2 hours off', async () => {
    await teacher
      .locator('.panel-timer')
      .getByRole('button', { name: '5 хв', exact: true })
      .click();
    await pc3.getByTestId('timer').waitFor();
    const skewedPc = await computer(browser);
    pcs.push(skewedPc);
    await skewedPc.addInitScript(() => {
      const real = Date.now.bind(Date);
      Date.now = () => real() + 2 * 3600 * 1000;
    });
    const skewed = await open(skewedPc, '/');
    await skewed.getByRole('button', { name: 'Я на уроці: 5-Г' }).click({ timeout: 15_000 });
    await skewed.getByRole('button', { name: 'Увійти як гість' }).click();
    await skewed.getByLabel("Номер комп'ютера").fill('9');
    await skewed.getByLabel("Ім'я та прізвище").fill('Дмитро');
    await skewed.getByRole('button', { name: 'Готово' }).click();
    await skewed.getByTestId('timer').waitFor();
    await skewed.waitForTimeout(1500); // clock sync
    const seconds = async (p: Page) => {
      const [m, s2] = (await p.getByTestId('timer').textContent())!
        .match(/\d\d:\d\d/)![0]
        .split(':');
      return Number(m) * 60 + Number(s2);
    };
    const [x, y] = [await seconds(skewed), await seconds(pc3)];
    expect(Math.abs(x - y)).toBeLessThanOrEqual(2);
    expect(x).toBeGreaterThan(250);
    await teacher.locator('.panel-timer').getByRole('button', { name: 'Стоп' }).click();
    await pc3.getByTestId('timer').waitFor({ state: 'detached' });
    expect(skewed.errors).toEqual([]);
  });

  it('console and pupil page in one browser do not sign each other out', async () => {
    const student = await open(teacherPc, '/');
    await student.getByRole('heading', { name: 'Введи код класу' }).waitFor({ timeout: 15_000 });
    await teacher.reload();
    await teacher.getByRole('heading', { name: 'Урок' }).waitFor({ timeout: 15_000 });
    await student.reload();
    await teacher.reload();
    await teacher.getByTestId('lesson-class').getByText('5-Г').waitFor({ timeout: 15_000 });
    expect(student.errors).toEqual([]);
    await student.close();
  });

  it('phones and tablets: no horizontal scroll on the console and the pupil page', async () => {
    for (const width of [375, 360, 768, 900]) {
      for (const page of [teacher, pc3]) {
        await page.setViewportSize({ width, height: 800 });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(
          overflow,
          `${page === teacher ? 'console' : 'pupil'} at ${width}px`,
        ).toBeLessThanOrEqual(0);
      }
    }
    await teacher.setViewportSize({ width: 1024, height: 768 });
    await pc3.setViewportSize({ width: 1024, height: 768 });
  });

  it('«Новий клас»: school PCs show the login of the new class, the PC number stays', async () => {
    await startClass('6-В');
    await pc3.getByTestId('lesson-badge').getByText('Урок: 6-В').waitFor({ timeout: 15_000 });
    await pc3.getByText('Комп’ютер 03').waitFor();
    await pc3.getByRole('button', { name: 'Марія С.' }).waitFor();
    await pc7.getByTestId('lesson-badge').getByText('Урок: 6-В').waitFor({ timeout: 15_000 });
    await pc7.getByText('Комп’ютер 07').waitFor();
    await teacher.getByText('Учнів ще немає').waitFor();
    expect([...pc3.errors, ...pc7.errors]).toEqual([]);
  });

  it('measured: a 45-minute lesson on 30 PCs stays far below 5 000 writes', async () => {
    // One guest PC with the heartbeat sped up 600× (100 ms instead of 60 s): 4.5 s
    // is a 45-minute lesson. Every write of the page is counted on the emulator.
    const ctx = await computer(browser);
    pcs.push(ctx);
    const page = await open(ctx, '/?hb=100');
    await page.getByRole('button', { name: /Увійти як гість/ }).click({ timeout: 15_000 });
    await page.getByLabel("Номер комп'ютера").fill('12');
    await page.getByLabel("Ім'я та прізвище").fill('Замір');
    await page.getByRole('button', { name: 'Готово' }).click();
    await page.getByTestId('lesson-screen').waitFor();
    const t0 = Date.now();
    // Typical lesson: a link, a message with «Я закінчив(ла)», a hand, a test.
    await teacher.getByRole('radio', { name: 'Посилання' }).click();
    await teacher.getByLabel('Адреса', { exact: true }).fill('example.com/2');
    await send();
    const [tab] = await Promise.all([
      ctx.waitForEvent('page'),
      page.getByRole('button', { name: 'Відкрити' }).click(),
    ]);
    await tab.close();
    await teacher.getByRole('radio', { name: 'Повідомлення' }).click();
    await teacher.getByLabel('Текст повідомлення').fill('Готуємось до тесту');
    await send();
    await page.getByRole('button', { name: 'Я закінчив(ла)' }).click();
    await page.getByRole('button', { name: 'Підняти руку' }).click();
    await page.getByRole('button', { name: 'Опустити руку' }).click();
    await teacher.getByRole('radio', { name: 'Тест' }).click();

    await chooseTest('Мережі');
    await send();
    await page.getByRole('button', { name: 'Почати тест' }).click();
    await page.getByRole('radio', { name: 'Інтернет' }).click();
    await page.getByRole('button', { name: 'Надіслати відповіді' }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Надіслати' }).click();
    await page.getByTestId('test-done').waitFor();
    await page.waitForTimeout(Math.max(0, 4500 - (Date.now() - t0)));
    const perPc = await page.evaluate(
      () => (window as unknown as { __infoklasWrites: number }).__infoklasWrites,
    );
    const lesson = perPc * 30 + 50; // + the teacher's writes (tasks, lock, timer): a few dozen
    process.stdout.write(
      `\n[measure] writes: ${perPc} per PC in a 45-minute lesson → ~${lesson} for 30 PCs\n`,
    );
    expect(perPc).toBeGreaterThanOrEqual(45);
    expect(lesson).toBeLessThan(5000);
    expect(page.errors).toEqual([]);

    // Leave the lab empty for the next scenarios.
    await teacher.getByRole('button', { name: 'Завершити урок' }).click();
    await teacher.getByRole('alertdialog').getByRole('button', { name: 'Завершити урок' }).click();
    await teacher.getByTestId('lesson-class').getByText('не обрано').waitFor();
    for (const c of pcs) await c.close();
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
