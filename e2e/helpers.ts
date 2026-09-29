import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';

/** Hosting emulator (serves apps/platform/dist with the same rewrites as production). */
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5000';
const PROJECT = 'demo-klas-pult';

export function chromiumPath(): string {
  if (process.env.CHROMIUM_109_PATH) return process.env.CHROMIUM_109_PATH;
  return execFileSync('node', [new URL('../tools/get-chromium109.mjs', import.meta.url).pathname], {
    encoding: 'utf8',
  }).trim();
}

export async function launch(): Promise<Browser> {
  return chromium.launch({ executablePath: chromiumPath(), args: ['--no-sandbox'] });
}

/** Wipes emulator data between scenarios (REST endpoints of the emulators). */
export async function resetEmulators() {
  await fetch(
    `http://localhost:8080/emulator/v1/projects/${PROJECT}/databases/(default)/documents`,
    { method: 'DELETE' },
  );
  await fetch(`http://localhost:9099/emulator/v1/projects/${PROJECT}/accounts`, {
    method: 'DELETE',
  });
}

export interface TrackedPage extends Page {
  errors: string[];
}

/** A separate "computer": its own browser context, 1024×768 like the school PCs. */
export async function computer(
  browser: Browser,
  viewport = { width: 1024, height: 768 },
): Promise<BrowserContext> {
  return browser.newContext({ viewport, locale: 'uk-UA' });
}

export async function open(ctx: BrowserContext, path: string): Promise<TrackedPage> {
  const page = (await ctx.newPage()) as TrackedPage;
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('dialog', (d) => {
    page.errors.push(`native dialog opened: ${d.type()} ${d.message()}`);
    void d.dismiss();
  });
  page.on('console', (m) => {
    if (m.type() === 'error') page.errors.push(m.text());
  });
  await page.goto(BASE_URL + path);
  return page;
}
