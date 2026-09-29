// Downloads Chromium 109.0.5414.0 (the version on the school PCs) for e2e tests.
// Linux snapshot r1070052; Клас-пульт uses the same version on Windows (r1070054).
// Prints the executable path. Usage: node tools/get-chromium109.mjs
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const DIR = join(ROOT, '.cache', 'chromium-109');
const EXE = join(DIR, 'chrome-linux', 'chrome');
const SNAPSHOT_URL =
  'https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/1070052/chrome-linux.zip';

if (process.platform !== 'linux') {
  console.error(
    'Only Linux is automated. On Windows use the Клас-пульт setup and set CHROMIUM_109_PATH.',
  );
  process.exit(1);
}
if (!existsSync(EXE)) {
  mkdirSync(DIR, { recursive: true });
  const zip = join(DIR, 'chrome-linux.zip');
  console.error(`Downloading Chromium 109 → ${DIR}`);
  execFileSync('curl', ['-fsSL', '--retry', '3', '-o', zip, SNAPSHOT_URL], { stdio: 'inherit' });
  execFileSync('unzip', ['-q', '-o', zip, '-d', DIR], { stdio: 'inherit' });
}
console.log(EXE);
