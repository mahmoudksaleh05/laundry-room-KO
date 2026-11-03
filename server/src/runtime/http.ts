import fastifyStatic from '@fastify/static';
import { recoverBody, registerBody } from '@suds/shared';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { existsSync } from 'node:fs';
import type { DB } from '../db';
import { CommandError, MIN, type Actor } from '../core/ctx';
import { transact } from '../core/engine';
import { authenticate, deleteUser, hashSecret, recover, register, verifySecret } from '../core/identity';
import type { Clock, makeHub } from './hub';
import { sendPushes, validSub } from './push';

/** In-memory sliding-window limiter. shortcut: resets on restart, fine for one instance. */
function limiter(max: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (key: string, now = Date.now()) => {
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= max) return false;
    list.push(now);
    hits.set(key, list);
    return true;
  };
}

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' ws: wss:",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

interface Deps {
  db: DB;
  clock: Clock;
  hub: ReturnType<typeof makeHub>;
  adminPin: string;
  clientDist: string;
  kickUser: (userId: number) => void;
  refreshDevice: (deviceHash: string) => void;
}

export async function registerHttp(app: FastifyInstance, d: Deps) {
  const { db, clock } = d;
  const pin = hashSecret(d.adminPin);
  const signupLimit = limiter(10, 60 * MIN);
  const recoverIpLimit = limiter(5, 60 * MIN);
  const recoverNameLimit = limiter(20, 60 * MIN);
  const adminFails = new Map<string, number[]>();
  const adminGlobal = limiter(30, 60 * MIN);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
  });

  const authed = (req: FastifyRequest, reply: FastifyReply): Actor | null => {
    const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
    const a = authenticate(db, token, clock.now());
    if (!a) reply.code(401).send({ ok: false, code: 'AUTH' });
    return a;
  };

  const run = <T>(reply: FastifyReply, fn: () => T) => {
    try {
      return reply.send({ ok: true, data: fn() });
    } catch (e) {
      if (e instanceof CommandError) return reply.code(400).send({ ok: false, code: e.code });
      throw e;
    }
  };

  app.get('/api/health', async () => ({ ok: true, now: clock.now() }));

  app.post('/api/register', async (req, reply) => {
    if (!signupLimit(req.ip)) return reply.code(429).send({ ok: false, code: 'RATE_LIMITED' });
    const body = registerBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, code: 'INVALID_INPUT' });
    return run(reply, () => transact(db, clock.now(), (c) => register(c, body.data)).result);
  });

  app.post('/api/recover', async (req, reply) => {
    const body = recoverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ ok: false, code: 'INVALID_INPUT' });
    if (!recoverIpLimit(req.ip) || !recoverNameLimit(body.data.name.toLowerCase())) {
      return reply.code(429).send({ ok: false, code: 'RATE_LIMITED' });
    }
    return run(reply, () => transact(db, clock.now(), (c) => recover(c, body.data)).result);
  });

  app.post('/api/push', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    const sub = (req.body as { subscription?: unknown })?.subscription;
    if (!validSub(sub)) return reply.code(400).send({ ok: false, code: 'INVALID_INPUT' });
    db.prepare('UPDATE devices SET push_sub = ? WHERE token_hash = ?').run(JSON.stringify(sub), a.deviceHash);
    return { ok: true };
  });

  app.delete('/api/push', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    db.prepare('UPDATE devices SET push_sub = NULL WHERE token_hash = ?').run(a.deviceHash);
    return { ok: true };
  });

  app.post('/api/push/test', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    await sendPushes(db, [{ key: `test:${clock.now()}`, userId: a.userId, title: 'Test alert 🫧', body: 'Alerts are working on this device.' }], clock.now());
    return { ok: true };
  });

  app.post('/api/admin/login', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    const now = Date.now();
    const fails = (adminFails.get(a.deviceHash) ?? []).filter((t) => now - t < 15 * MIN);
    if (fails.length >= 5 || !adminGlobal(req.ip)) return reply.code(429).send({ ok: false, code: 'LOCKED_OUT' });
    const given = String((req.body as { pin?: unknown })?.pin ?? '').slice(0, 32);
    if (!verifySecret(given, pin)) {
      adminFails.set(a.deviceHash, [...fails, now]);
      return reply.code(403).send({ ok: false, code: 'BAD_CODE' });
    }
    adminFails.delete(a.deviceHash);
    db.prepare('UPDATE devices SET admin_until = ? WHERE token_hash = ?').run(clock.now() + 8 * 60 * MIN, a.deviceHash);
    transact(db, clock.now(), (c) => {
      c.db.prepare("INSERT INTO events(at, user_id, action) VALUES (?, ?, 'admin_login')").run(c.now, a.userId);
    });
    d.refreshDevice(a.deviceHash);
    return { ok: true };
  });

  app.delete('/api/me', async (req, reply) => {
    const a = authed(req, reply);
    if (!a) return;
    const r = transact(db, clock.now(), (c) => deleteUser(c, a.userId));
    d.kickUser(a.userId);
    d.hub.after(r);
    return { ok: true };
  });

  if (existsSync(d.clientDist)) {
    await app.register(fastifyStatic, {
      root: d.clientDist,
      wildcard: false,
      setHeaders(res, path) {
        res.header('Cache-Control', /[\\/]assets[\\/]/.test(path) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });
    // Single-page app: unknown non-API paths get index.html.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io')) {
        return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
      }
      return reply.code(404).send({ ok: false, code: 'NOT_FOUND' });
    });
  }
}
