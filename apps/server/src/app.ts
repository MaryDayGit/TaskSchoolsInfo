import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import Fastify, { type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import jwt from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.js';
import type { Db } from './db/client.js';
import { HttpError } from './lib/errors.js';
import { LiveManager } from './live/manager.js';
import { teacherAuthRoutes } from './routes/teacherAuth.js';
import { classRoutes } from './routes/classes.js';
import { quizRoutes } from './routes/quizzes.js';
import { assignmentRoutes } from './routes/assignments.js';
import { studentAuthRoutes } from './routes/studentAuth.js';
import { studentRoutes } from './routes/student.js';
import { liveRoutes } from './routes/live.js';

declare module 'fastify' {
  interface FastifyInstance {
    config: Config;
    db: Db;
    live: LiveManager;
  }
}

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger?: FastifyServerOptions['logger'];
}

export async function buildApp({ config, db, logger = false }: BuildAppOptions) {
  const app = Fastify({
    logger,
    trustProxy: config.trustProxy,
    bodyLimit: 512 * 1024,
  });

  app.decorate('config', config);
  app.decorate('db', db);
  app.decorate('live', new LiveManager(db, app.log));

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        imgSrc: ["'self'", 'data:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(jwt, { secret: config.jwtSecret });
  // A whole class usually shares one school IP, so the global limit is generous;
  // sensitive endpoints set tighter limits and student logins use per-account lockout.
  await app.register(rateLimit, { global: true, max: 1000, timeWindow: '1 minute' });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      const first = err.issues[0];
      return reply.status(400).send({ error: first?.message ?? 'Некоректні дані', details: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      const message =
        status === 429 ? 'Забагато запитів. Спробуйте за хвилину.' : (err as Error).message;
      return reply.status(status).send({ error: message });
    }
    req.log.error(err);
    return reply.status(500).send({ error: 'Помилка сервера. Спробуйте ще раз.' });
  });

  app.get('/api/health', async () => ({ ok: true }));

  await app.register(teacherAuthRoutes);
  await app.register(classRoutes);
  await app.register(quizRoutes);
  await app.register(assignmentRoutes);
  await app.register(studentAuthRoutes);
  await app.register(studentRoutes);
  await app.register(liveRoutes);

  const webDist = config.webDistDir ? resolve(config.webDistDir) : null;
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    // SPA fallback: unknown non-API GET routes get index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Не знайдено' });
    });
  } else {
    app.setNotFoundHandler((_req, reply) => reply.status(404).send({ error: 'Не знайдено' }));
  }

  app.addHook('onClose', async () => {
    await app.live.shutdown();
  });

  return app;
}
