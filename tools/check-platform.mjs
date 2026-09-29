// Checks for the unified platform (apps/platform) that ESLint can't express:
//  1. no emoji in the UI source: Windows 7 shows them as empty squares;
//  2. the student page's JS (entry chunk + its static imports) fits the budget.
// Usage: node tools/check-platform.mjs  (after `npm run build -w @infoklas/platform`)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { gzipSync } from 'node:zlib';

const ROOT = new URL('..', import.meta.url).pathname;
const SRC = join(ROOT, 'apps/platform/src');
const DIST = join(ROOT, 'apps/platform/dist');
const STUDENT_JS_BUDGET_KB = 200;

let failed = false;
const fail = (msg) => {
  failed = true;
  console.error('✖ ' + msg);
};

// 1. Emoji
const EMOJI = /\p{Extended_Pictographic}/u;
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
for (const file of walk(SRC).filter((f) => /\.(tsx?|css|html)$/.test(f))) {
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, i) => {
      if (EMOJI.test(line)) fail(`emoji in ${relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
    });
}

// 2. Student page JS budget: the scripts index.html loads eagerly.
const html = readFileSync(join(DIST, 'index.html'), 'utf8');
const scripts = [
  ...html.matchAll(/<(?:script[^>]+src|link[^>]+rel="modulepreload"[^>]+href)="\/([^"]+\.js)"/g),
].map((m) => m[1]);
if (scripts.length === 0) fail('no scripts found in dist/index.html — build first');
const gz = scripts.reduce((sum, f) => sum + gzipSync(readFileSync(join(DIST, f))).length, 0) / 1024;
const line = `student page JS: ${gz.toFixed(1)} KB gzip (budget ${STUDENT_JS_BUDGET_KB} KB) — ${scripts.join(', ')}`;
if (gz > STUDENT_JS_BUDGET_KB) fail(line);
else console.log('✔ ' + line);

if (failed) process.exit(1);
console.log('✔ no emoji in apps/platform/src');
