import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const prod = process.env.NODE_ENV === 'production';

function need(name: string, devDefault: string): string {
  const v = process.env[name];
  if (v) return v;
  if (prod) throw new Error(`Missing required environment variable ${name}`);
  return devDefault;
}

const dataDir = resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });

export const env = {
  prod,
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3000),
  dataDir,
  dbFile: resolve(dataDir, 'sudsqueue.db'),
  dormCode: need('DORM_CODE', 'SUDS'),
  adminPin: need('ADMIN_PIN', '0000'),
  tz: process.env.TZ_NAME ?? 'UTC',
  vapidPublic: process.env.VAPID_PUBLIC,
  vapidPrivate: process.env.VAPID_PRIVATE,
  vapidSubject: need('VAPID_SUBJECT', 'mailto:dev@sudsqueue.test'),
  demo: process.env.DEMO === '1',
  clientDist: process.env.CLIENT_DIST ?? fileURLToPath(new URL('../../../client/dist', import.meta.url)),
};
