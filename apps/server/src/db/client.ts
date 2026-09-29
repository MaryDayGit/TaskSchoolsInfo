import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { FastifyBaseLogger } from 'fastify';
import pg from 'pg';
import { retry } from '../lib/retry.js';
import * as schema from './schema.js';

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

/** Works both from src/db (dev, tests) and from the bundled dist/index.js. */
export function resolveMigrationsFolder(): string {
  const candidates = ['../../drizzle', '../drizzle'].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Migrations folder not found (looked in ${candidates.join(', ')})`);
  return found;
}

export async function connectPostgres(url: string, log: FastifyBaseLogger) {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    // Release idle connections before a managed database (e.g. Neon scaling to zero) drops them.
    idleTimeoutMillis: 30_000,
    // A sleeping serverless database may need a few seconds to wake up.
    connectionTimeoutMillis: 15_000,
    keepAlive: true,
  });
  // Without a listener, a dropped idle connection emits an unhandled 'error' event and
  // crashes the process. The pool replaces the connection on the next query.
  pool.on('error', (err) => log.warn({ err: err.message }, 'idle database connection closed'));

  const db = drizzle(pool, { schema });
  // The database may still be starting (fresh deploy, woken-up serverless compute), so
  // retry for about a minute instead of crashing on the first attempt.
  await retry(() => migrate(db, { migrationsFolder: resolveMigrationsFolder() }), {
    attempts: 8,
    initialDelayMs: 1000,
    maxDelayMs: 15_000,
    onRetry: (err, attempt, delayMs) =>
      log.warn(
        { err: err instanceof Error ? err.message : String(err), attempt, delayMs },
        'database not reachable yet, retrying',
      ),
  });
  return { db: db as unknown as Db, close: () => pool.end() };
}
