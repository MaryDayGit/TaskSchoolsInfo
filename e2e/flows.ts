/*
 * Общие шаги сценариев: учитель (код, классы, ученики) и вход учеников.
 * Используются в extended.e2e.test.ts; platform.e2e.test.ts держит свои копии.
 */
import { expect } from 'vitest';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { BASE_URL, computer, open, type TrackedPage } from './helpers';

export const CLASSES_HEADING = { name: 'Мої класи' };

/** First run on a clean emulator: the teacher invents a code and lands in the cabinet. */
export async function firstRun(ctx: BrowserContext, code: string): Promise<TrackedPage> {
  const page = await open(ctx, '/t');
  await page.getByText('Перший запуск').waitFor({ timeout: 15_000 });
  await page.getByLabel('Новий код учителя').fill(code);
  await page.getByLabel('Повторіть код').fill(code);
  await page.getByRole('button', { name: 'Зберегти код і відкрити кабінет' }).click();
  await page.getByRole('heading', CLASSES_HEADING).waitFor();
  return page;
}

export async function createClass(t: Page, name: string, grade: number): Promise<string> {
  await t.goto(`${BASE_URL}/t`);
  await t.getByRole('button', { name: '+ Новий клас' }).click();
  await t.getByLabel('Назва класу').fill(name);
  await t.getByLabel('Рік навчання').selectOption(String(grade));
  await t.getByRole('button', { name: 'Створити' }).click();
  await t.getByRole('heading', { name: `Клас ${name}` }).waitFor();
  const code = (await t.getByTestId('join-code').locator('strong').textContent())!.trim();
  expect(code).toMatch(/^\d{6}$/);
  return code;
}

export async function addStudents(t: Page, names: string[]) {
  await t.getByLabel('Додати учнів').fill(names.join('\n'));
  await t.getByRole('button', { name: `Додати (${names.length})` }).click();
  for (const n of names) await t.getByTestId(`student-${n}`).waitFor();
}

/** Word passwords (grades 5–9) of the listed pupils, as the teacher sees them. */
export async function words(t: Page, names: string[]): Promise<string[]> {
  const show = t.getByLabel('Показати паролі');
  if (!(await show.isChecked())) await show.check();
  const out: string[] = [];
  for (const n of names) {
    out.push((await t.getByTestId(`student-${n}`).locator('.secret-word').textContent())!.trim());
  }
  return out;
}

/** Picture passwords (grades 2–4). */
export async function pictures(t: Page, name: string): Promise<string[]> {
  const show = t.getByLabel('Показати паролі');
  if (!(await show.isChecked())) await show.check();
  const row = t.getByTestId(`student-${name}`);
  await row.locator('.secret-pictures svg').first().waitFor();
  return row
    .locator('.secret-pictures svg')
    .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
}

/** A pupil on a new device logs in by a /join link with a word password. */
export async function pupilWithWord(
  browser: Browser,
  code: string,
  name: string,
  word: string,
  viewport?: { width: number; height: number },
) {
  const ctx = await computer(browser, viewport);
  const page = await open(ctx, `/join/${code}`);
  await page.getByRole('button', { name }).click({ timeout: 15_000 });
  await page.getByLabel('Пароль').fill(word);
  await page.getByRole('button', { name: 'Увійти' }).click();
  await page.getByRole('heading', { name: `Привіт, ${name}!` }).waitFor();
  return { ctx, page };
}

/** A pupil of grades 2–4 logs in with pictures. */
export async function pupilWithPictures(
  browser: Browser,
  code: string,
  name: string,
  labels: string[],
) {
  const ctx = await computer(browser);
  const page = await open(ctx, `/join/${code}`);
  await page.getByRole('button', { name }).click({ timeout: 15_000 });
  for (const l of labels) await page.getByRole('button', { name: l, exact: true }).click();
  await page.getByRole('heading', { name: `Привіт, ${name}!` }).waitFor();
  return { ctx, page };
}

export const overflow = (p: Page) =>
  p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
