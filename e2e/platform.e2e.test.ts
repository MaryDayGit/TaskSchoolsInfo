/*
 * Сценарии этапа 1 в Chromium 109 (версия школьных ПК) на эмуляторах Firebase.
 * Запуск: npm run test:e2e (сам собирает приложение и поднимает эмуляторы).
 * Сценарии идут по порядку и используют общее состояние эмулятора.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser, BrowserContext } from 'playwright-core';
import { BASE_URL, computer, launch, open, resetEmulators } from './helpers';

let browser: Browser;
let teacherPc: BrowserContext;
const CODE = '5555';

beforeAll(async () => {
  await resetEmulators();
  browser = await launch();
  teacherPc = await computer(browser);
});

afterAll(async () => {
  await browser?.close();
});

describe('stage 1 in Chromium 109', () => {
  it('runs the school browser version', () => {
    expect(browser.version()).toMatch(/^109\./);
  });

  it('student page connects without errors', async () => {
    const pupil = await computer(browser);
    const page = await open(pupil, '/');
    await page.getByRole('heading', { name: 'Сторінка учня' }).waitFor();
    await page.getByTestId('connection').getByText("Зв'язок є").waitFor({ timeout: 15_000 });
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
    await page.getByRole('heading', { name: 'Єдина платформа ІнфоКлас' }).waitFor();
    // 12 SVG picture passwords render (no emoji on Windows 7).
    expect(await page.locator('.picture-gallery svg').count()).toBe(12);
    expect(page.errors).toEqual([]);
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
    await page.getByRole('heading', { name: 'Єдина платформа ІнфоКлас' }).waitFor();
    expect(page.errors).toEqual([]);
    await other.close();
  });

  it('teacher and student pages in one browser do not sign each other out', async () => {
    const student = await open(teacherPc, '/');
    await student.getByTestId('connection').getByText("Зв'язок є").waitFor({ timeout: 15_000 });
    const teacher = await open(teacherPc, '/t');
    await teacher
      .getByRole('heading', { name: 'Єдина платформа ІнфоКлас' })
      .waitFor({ timeout: 15_000 });
    await student.reload();
    await teacher.reload();
    await teacher
      .getByRole('heading', { name: 'Єдина платформа ІнфоКлас' })
      .waitFor({ timeout: 15_000 });
    expect([...student.errors, ...teacher.errors]).toEqual([]);
    await student.close();
    await teacher.close();
  });

  it('logout uses the in-page dialog and forgets this browser', async () => {
    const page = await open(teacherPc, '/t');
    await page.getByRole('button', { name: 'Вийти' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Вийти з кабінету?' });
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await page.getByRole('heading', { name: 'Єдина платформа ІнфоКлас' }).waitFor();

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
          .locator(path === '/' ? '.task-card' : '.login input')
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
