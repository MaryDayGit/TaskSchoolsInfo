import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  /**
   * Teacher self-registration. The first teacher can always register; after that
   * sign-up is closed unless this is "true".
   */
  TEACHER_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /** Directory with the built web app to serve (production). */
  WEB_DIST_DIR: z.string().optional(),
  /** Set when running behind a reverse proxy (Render, nginx, …). */
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type Config = {
  env: 'development' | 'production' | 'test';
  port: number;
  host: string;
  databaseUrl: string;
  jwtSecret: string;
  teacherSignup: boolean;
  webDistDir: string | undefined;
  trustProxy: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`);
    throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
  }
  const e = parsed.data;
  return {
    env: e.NODE_ENV,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL,
    jwtSecret: e.JWT_SECRET,
    teacherSignup: e.TEACHER_SIGNUP,
    webDistDir: e.WEB_DIST_DIR,
    trustProxy: e.TRUST_PROXY,
  };
}
