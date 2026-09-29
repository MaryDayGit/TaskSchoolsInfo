import { pino } from 'pino';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectPostgres } from './db/client.js';
import { attachLiveSocket } from './live/socket.js';

const log = pino({ level: process.env.LOG_LEVEL ?? 'info' });

// Keep serving other users when a single request fails in an unexpected way; the
// hosting platform restarts the process only if it really crashes.
process.on('unhandledRejection', (reason) =>
  log.error({ err: reason }, 'unhandled promise rejection'),
);
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'uncaught exception, exiting');
  process.exit(1);
});

const config = loadConfig();
const { db, close } = await connectPostgres(config.databaseUrl, log);

const app = await buildApp({ config, db, loggerInstance: log });
await app.live.abortStaleSessions();
const io = attachLiveSocket(app, app.server);

await app.listen({ port: config.port, host: config.host });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, 'shutting down');
  // Never hang a deploy: force-exit if closing takes too long.
  setTimeout(() => process.exit(1), 10_000).unref();
  io.disconnectSockets(true);
  await app.close(); // also saves results of unfinished live games
  await close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
