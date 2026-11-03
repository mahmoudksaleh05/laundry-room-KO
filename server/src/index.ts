import Fastify from 'fastify';
import { Server } from 'socket.io';
import { openDb } from './db';
import { transact } from './core/engine';
import { ensureDormCode } from './core/identity';
import { env } from './runtime/env';
import { registerHttp } from './runtime/http';
import { makeClock, makeHub } from './runtime/hub';
import { setupVapid } from './runtime/push';
import { attachSockets } from './runtime/socket';

const db = openDb(env.dbFile, env.tz);
ensureDormCode(db, env.dormCode);
const vapidPublicKey = setupVapid(db, env.vapidPublic, env.vapidPrivate, env.vapidSubject);
const clock = makeClock(env.demo);

const app = Fastify({ logger: { level: env.prod ? 'info' : 'warn' }, trustProxy: true, bodyLimit: 16 * 1024 });
const io = new Server(app.server, { serveClient: false, maxHttpBufferSize: 16 * 1024 });
const hub = makeHub(db, clock, io);
const sockets = attachSockets(io, db, clock, hub, vapidPublicKey);
await registerHttp(app, {
  db,
  clock,
  hub,
  adminPin: env.adminPin,
  clientDist: env.clientDist,
  kickUser: sockets.kickUser,
  refreshDevice: sockets.refreshDevice,
});

// Catch up on anything that expired while we were down — same code the scheduler runs.
transact(db, clock.now(), () => undefined);
const timer = setInterval(hub.tick, 1000);

await app.listen({ port: env.port, host: '0.0.0.0' });
console.log(`SudsQueue on :${env.port}${env.demo ? ' (DEMO clock)' : ''}`);

const stop = async () => {
  clearInterval(timer);
  io.close();
  await app.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
