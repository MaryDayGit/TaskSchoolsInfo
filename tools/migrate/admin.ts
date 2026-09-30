import { readFileSync } from 'node:fs';
import { cert, initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

/**
 * Firestore через Admin SDK (правила не действуют).
 *
 * - Эмулятор: задан FIRESTORE_EMULATOR_HOST (например 127.0.0.1:8080), проект — из --project.
 * - Боевая база: GOOGLE_APPLICATION_CREDENTIALS — путь к ключу сервисного аккаунта
 *   (скачивается в консоли Firebase, в репозиторий не кладётся).
 */
export function connect(project: string | undefined): {
  db: Firestore;
  project: string;
  emulator: boolean;
} {
  const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
  let app: App;
  if (emulator) {
    const projectId = project ?? 'demo-klas-pult';
    app = initializeApp({ projectId });
    return { db: getFirestore(app), project: projectId, emulator };
  }
  const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (!keyPath) {
    throw new Error(
      'Не задано GOOGLE_APPLICATION_CREDENTIALS (ключ сервисного аккаунта) или FIRESTORE_EMULATOR_HOST.',
    );
  }
  const key = JSON.parse(readFileSync(keyPath, 'utf8')) as { project_id: string };
  const projectId = project ?? key.project_id;
  if (projectId !== key.project_id) {
    throw new Error(`Ключ от проекта ${key.project_id}, а указан --project ${projectId}.`);
  }
  app = initializeApp({ credential: cert(keyPath), projectId });
  return { db: getFirestore(app), project: projectId, emulator };
}

/** --name value / --flag из process.argv. */
export function args(argv = process.argv.slice(2)) {
  const out: Record<string, string | true> = {};
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      rest.push(a);
      continue;
    }
    const [name, inline] = a.slice(2).split('=', 2) as [string, string | undefined];
    if (inline !== undefined) out[name] = inline;
    else if (argv[i + 1] && !argv[i + 1]!.startsWith('--')) out[name] = argv[++i]!;
    else out[name] = true;
  }
  return { flags: out, rest };
}

export const str = (v: string | true | undefined) => (typeof v === 'string' ? v : undefined);
