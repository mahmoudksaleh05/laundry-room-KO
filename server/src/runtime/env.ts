import { resolve } from 'node:path';

const prod = process.env.NODE_ENV === 'production';

function need(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (prod) throw new Error(`Missing required environment variable ${name}`);
  return devDefault;
}

export const env = {
  prod,
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  /** Postgres (Supabase) connection string. Unset = local SQLite file in DATA_DIR. */
  databaseUrl: process.env.DATABASE_URL,
  dbFile: resolve(process.env.DATA_DIR ?? './data', 'sudsqueue.db'),
  adminPin: need('ADMIN_PIN', '0000'),
  /** Shared secret the every-minute cron sends to /api/tick. */
  cronSecret: need('CRON_SECRET', 'dev-cron'),
  tz: process.env.TZ_NAME ?? 'Europe/Budapest',
  vapidPublic: process.env.VAPID_PUBLIC,
  vapidPrivate: process.env.VAPID_PRIVATE,
  vapidSubject: need('VAPID_SUBJECT', 'mailto:dev@sudsqueue.test'),
  demo: process.env.DEMO === '1',
};
