import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { connectPostgres } from './db/client.js';
import { attachLiveSocket } from './live/socket.js';

const config = loadConfig();
const { db, close } = await connectPostgres(config.databaseUrl);

const app = await buildApp({
  config,
  db,
  logger: config.env === 'development' ? { level: 'info', transport: undefined } : { level: 'info' },
});
await app.live.abortStaleSessions();
const io = attachLiveSocket(app, app.server);

await app.listen({ port: config.port, host: config.host });

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  app.log.info({ signal }, 'shutting down');
  io.disconnectSockets(true);
  await app.close(); // also saves results of unfinished live games
  await close();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
