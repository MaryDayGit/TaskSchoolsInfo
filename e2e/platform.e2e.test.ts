/*
 * Сценарии единой платформы в Chromium 109 (версия школьных ПК) на эмуляторах
 * Firebase. Запуск: npm run test:e2e (сам собирает приложение и поднимает эмуляторы).
 * Сценарии идут по порядку и используют общее состояние эмулятора.
 */
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
  return row.locator('.secret-pictures svg').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
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

    const wrong = olaPictures[0] === 'Кіт' ? ['Пес', 'Пес', 'Пес', 'Пес'] : ['Кіт', 'Кіт', 'Кіт', 'Кіт'];
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
    await teacher.getByTestId('student-Оля К.').getByRole('button', { name: 'Новий пароль' }).click();
    await teacher.getByRole('alertdialog').getByRole('button', { name: 'Видати новий' }).click();
    await teacher.getByTestId('student-Оля К.').getByText('ще не входив(ла)').waitFor();
    await page.reload();
    await page.getByText('Вчитель видав тобі новий пароль').waitFor({ timeout: 15_000 });
    await page.getByRole('heading', { name: 'Введи код класу' }).waitFor();
    expect(page.errors).toEqual([]);
    await pc.close();
  });

  it('a middle-school pupil logs in with a word password on a phone via a /join link', async () => {
    const code7 = await createClass('7-Б', 7);
    await addStudents(['Іван Т.']);
    await teacher.getByLabel('Показати паролі').check();
    const word = (await teacher.getByTestId('student-Іван Т.').locator('.secret-word').textContent())!.trim();
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
    await page.getByRole('heading', { name: 'Введи код класу' }).waitFor();
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
