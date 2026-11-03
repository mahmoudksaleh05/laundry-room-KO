import { buildApp } from './app';
import { env } from './runtime/env';

// Local / self-hosted entry. On Vercel the same app runs from vercel.ts.
const app = buildApp();
await app.listen({ port: env.port, host: '0.0.0.0' });
console.log(`SudsQueue API on :${env.port}${env.demo ? ' (DEMO clock)' : ''}`);

// Stands in for the database cron: move time forward every 20 s.
const tick = () => app.inject({ method: 'POST', url: '/api/tick', headers: { 'x-cron-secret': env.cronSecret } }).catch(console.error);
const timer = setInterval(tick, 20_000);
void tick();

const stop = async () => {
  clearInterval(timer);
  await app.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
