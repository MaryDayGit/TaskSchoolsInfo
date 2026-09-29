import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { FastifyInstance, InjectOptions } from 'fastify';
import { buildApp } from '../app.js';
import type { Config } from '../config.js';
import type { Db } from '../db/client.js';
import * as schema from '../db/schema.js';
import type { Question } from '@infoklas/shared';

export const testConfig: Config = {
  env: 'test',
  port: 0,
  host: '127.0.0.1',
  databaseUrl: 'pglite://memory',
  jwtSecret: 'test-secret-test-secret-test-secret-1234',
  teacherSignup: true,
  webDistDir: undefined,
  trustProxy: false,
};

export async function createTestApp(overrides: Partial<Config> = {}) {
  const client = new PGlite();
  const pgliteDb = drizzle(client, { schema });
  await migrate(pgliteDb, {
    migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)),
  });
  const db = pgliteDb as unknown as Db;
  const app = await buildApp({ config: { ...testConfig, ...overrides }, db });
  return {
    app,
    db,
    close: async () => {
      await app.close();
      await client.close();
    },
  };
}

/** Minimal cookie-keeping HTTP client over fastify.inject. */
export class Agent {
  private cookies = new Map<string, string>();
  constructor(private app: FastifyInstance) {}

  get cookieHeader() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  async request(method: InjectOptions['method'], url: string, body?: unknown) {
    const res = await this.app.inject({
      method,
      url,
      payload: body as InjectOptions['payload'],
      headers: this.cookies.size ? { cookie: this.cookieHeader } : {},
    });
    for (const c of res.cookies) {
      if (c.value === '' || (c.maxAge !== undefined && c.maxAge <= 0)) this.cookies.delete(c.name);
      else this.cookies.set(c.name, c.value);
    }
    return res;
  }

  get = (url: string) => this.request('GET', url);
  post = (url: string, body: unknown = {}) => this.request('POST', url, body);
  put = (url: string, body: unknown) => this.request('PUT', url, body);
  patch = (url: string, body: unknown) => this.request('PATCH', url, body);
  delete = (url: string) => this.request('DELETE', url);
}

let teacherN = 0;
export async function registerTeacher(app: FastifyInstance) {
  const agent = new Agent(app);
  const email = `teacher${++teacherN}@school.ua`;
  const res = await agent.post('/api/auth/register', {
    email,
    name: 'Марія Іванівна',
    password: 'super-secret-1',
  });
  if (res.statusCode !== 200) throw new Error(`register failed: ${res.body}`);
  return agent;
}

export const sampleQuestions: Question[] = [
  {
    id: 'q1',
    type: 'single',
    prompt: 'Скільки бітів у байті?',
    timeLimitSec: 20,
    options: [
      { id: 'a', text: '4' },
      { id: 'b', text: '8' },
    ],
    correctOptionId: 'b',
  },
  {
    id: 'q2',
    type: 'multiple',
    prompt: 'Що є пристроями введення?',
    timeLimitSec: 30,
    options: [
      { id: 'a', text: 'Клавіатура' },
      { id: 'b', text: 'Монітор' },
      { id: 'c', text: 'Мишка' },
    ],
    correctOptionIds: ['a', 'c'],
  },
  {
    id: 'q3',
    type: 'text',
    prompt: 'Як називається найменша одиниця інформації?',
    timeLimitSec: 30,
    acceptedAnswers: ['біт'],
  },
];
