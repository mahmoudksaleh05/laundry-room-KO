import { loginBody, registerBody, type Ack } from '@suds/shared';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { getConfig, setConfig } from './db';
import { CommandError, MIN, type Actor } from './core/ctx';
import { execCommand, transact, type TxResult } from './core/engine';
import { authenticate, deleteUser, hashSecret, login, register, verifySecret } from './core/identity';
import { duePushes } from './core/pushes';
import { buildSnapshot, chatList, housekeeping, meOf } from './core/snapshot';
import { env } from './runtime/env';
import { sendPushes, setupVapid, validSub } from './runtime/push';
import { withDb, type Session } from './runtime/store';

/** Sliding-window limiter. shortcut: per serverless instance, so it slows abuse rather than stopping it. */
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

type Changes = Pick<TxResult<unknown>, 'changed' | 'chatChanged'>;

const stateOf = (s: Session) =>
  transact(s.db, s.now, (c) => ({ snapshot: buildSnapshot(c, env.demo), chat: chatList(c) })).result;
const vapid = (s: Session) => setupVapid(s.db, env.vapidPublic, env.vapidPrivate, env.vapidSubject);

/** After a change: tell every phone, and send any alerts that are now due. */
async function settle(s: Session, r: Changes) {
  if (r.changed || r.chatChanged) s.publish(stateOf(s));
  const due = transact(s.db, s.now, (c) => duePushes(c)).result;
  if (due.length) {
    vapid(s);
    await sendPushes(s.db, due, s.now);
  }
}

const bearer = (req: FastifyRequest) => req.headers.authorization?.replace(/^Bearer /, '') ?? '';
const deny = (reply: FastifyReply, status: number, code: string) => reply.code(status).send({ ok: false, code });

export function buildApp() {
  const app = Fastify({ trustProxy: true, bodyLimit: 16 * 1024 });
  const pin = hashSecret(env.adminPin);
  // Generous: a whole dorm on one Wi-Fi shares a single public IP.
  const signupLimit = limiter(60, 60 * MIN);
  const loginLimit = limiter(120, 60 * MIN);
  const tickLimit = limiter(30, MIN);
  const cmdLimit = limiter(20, 10_000);
  const adminFails = new Map<string, number[]>();
  const adminGlobal = limiter(30, 60 * MIN);

  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Referrer-Policy', 'no-referrer');
  });
  app.setErrorHandler((e, _req, reply) => {
    if (e instanceof CommandError) return deny(reply, 400, e.code);
    console.error(e);
    return deny(reply, 500, 'INTERNAL');
  });

  /** Signed-in route: runs inside one locked database session. */
  const authed = (fn: (s: Session, a: Actor, req: FastifyRequest, reply: FastifyReply) => unknown) => (req: FastifyRequest, reply: FastifyReply) =>
    withDb(async (s) => {
      const a = authenticate(s.db, bearer(req), s.now);
      if (!a) return deny(reply, 401, 'AUTH');
      return fn(s, a, req, reply);
    });

  /** Everything a phone needs to draw the app. */
  const full = (s: Session, a: Actor) => ({
    me: transact(s.db, s.now, (c) => meOf(c, a)).result,
    ...stateOf(s),
    vapidPublicKey: vapid(s),
    serverNow: s.now,
  });

  app.get('/api/health', async () => ({ ok: true, now: Date.now() }));

  app.post('/api/register', (req, reply) => {
    if (!signupLimit(req.ip)) return deny(reply, 429, 'RATE_LIMITED');
    const body = registerBody.safeParse(req.body);
    if (!body.success) return deny(reply, 400, 'INVALID_INPUT');
    return withDb((s) => ({ ok: true, data: transact(s.db, s.now, (c) => register(c, body.data)).result }));
  });

  app.post('/api/login', (req, reply) => {
    if (!loginLimit(req.ip)) return deny(reply, 429, 'RATE_LIMITED');
    const body = loginBody.safeParse(req.body);
    if (!body.success) return deny(reply, 400, 'INVALID_INPUT');
    return withDb((s) => ({ ok: true, data: transact(s.db, s.now, (c) => login(c, body.data)).result }));
  });

  app.get(
    '/api/state',
    authed(async (s, a) => {
      await settle(s, transact(s.db, s.now, () => undefined));
      return { ok: true, data: full(s, a) };
    }),
  );

  app.post(
    '/api/cmd',
    authed(async (s, a, req, reply) => {
      if (!cmdLimit(String(a.userId))) return deny(reply, 429, 'RATE_LIMITED');
      const { clientActionId, type, input } = (req.body ?? {}) as { clientActionId?: unknown; type?: unknown; input?: unknown };
      if (typeof clientActionId !== 'string' || clientActionId.length > 64 || typeof type !== 'string' || type.length > 32) {
        return deny(reply, 400, 'INVALID_INPUT');
      }
      // Idempotency: a retried action gets the first answer back.
      const prev = s.db
        .prepare('SELECT result FROM actions WHERE user_id = ? AND client_action_id = ?')
        .get(a.userId, clientActionId) as { result: string } | undefined;
      let ack: Ack;
      let r: Changes = { changed: false, chatChanged: false };
      if (prev) ack = JSON.parse(prev.result);
      else if (type === 'exitAdmin') {
        s.db.prepare('UPDATE devices SET admin_until = NULL WHERE token_hash = ?').run(a.deviceHash);
        ack = { ok: true };
      } else if (type === 'demoForward') {
        const minutes = Number((input as { minutes?: number })?.minutes);
        if (!a.isAdmin) ack = { ok: false, code: 'NOT_ADMIN' };
        else if (!env.demo || !Number.isInteger(minutes) || minutes < 1 || minutes > 600) ack = { ok: false, code: 'INVALID_INPUT' };
        else {
          setConfig(s.db, 'clock_offset', String(Number(getConfig(s.db, 'clock_offset') ?? 0) + minutes * MIN));
          s.now += minutes * MIN;
          r = transact(s.db, s.now, () => undefined);
          r = { changed: true, chatChanged: r.chatChanged };
          ack = { ok: true };
        }
      } else {
        const x = execCommand(s.db, s.now, a, type, input);
        ack = x.result;
        r = x;
      }
      if (!prev) {
        s.db
          .prepare('INSERT OR IGNORE INTO actions(user_id, client_action_id, result, at) VALUES (?, ?, ?, ?)')
          .run(a.userId, clientActionId, JSON.stringify(ack), s.now);
      }
      await settle(s, r);
      const fresh = authenticate(s.db, bearer(req), s.now) ?? a; // admin flag may have changed
      return { ok: true, data: { ack, state: full(s, fresh) } };
    }),
  );

  /** Moves time forward: called every minute by the database's cron, and by phones when a timer hits zero. */
  app.post('/api/tick', (req, reply) => {
    const cron = req.headers['x-cron-secret'] === env.cronSecret;
    if (!cron && !tickLimit(req.ip)) return deny(reply, 429, 'RATE_LIMITED');
    return withDb(async (s) => {
      const r = transact(s.db, s.now, () => undefined);
      const changes: Changes = { changed: r.changed, chatChanged: r.chatChanged };
      if (s.now - Number(getConfig(s.db, 'housekeeping_at') ?? 0) > 60 * MIN) {
        const h = transact(s.db, s.now, (c) => housekeeping(c));
        setConfig(s.db, 'housekeeping_at', String(s.now));
        changes.changed ||= h.changed;
        changes.chatChanged = true;
        s.backup();
      }
      await settle(s, changes);
      return { ok: true };
    });
  });

  app.post(
    '/api/push',
    authed((s, a, req, reply) => {
      const sub = (req.body as { subscription?: unknown })?.subscription;
      if (!validSub(sub)) return deny(reply, 400, 'INVALID_INPUT');
      s.db.prepare('UPDATE devices SET push_sub = ? WHERE token_hash = ?').run(JSON.stringify(sub), a.deviceHash);
      return { ok: true };
    }),
  );

  app.delete(
    '/api/push',
    authed((s, a) => {
      s.db.prepare('UPDATE devices SET push_sub = NULL WHERE token_hash = ?').run(a.deviceHash);
      return { ok: true };
    }),
  );

  app.post(
    '/api/push/test',
    authed(async (s, a) => {
      vapid(s);
      await sendPushes(s.db, [{ key: `test:${s.now}`, userId: a.userId, title: 'Test alert 🫧', body: 'Alerts are working on this device.' }], s.now);
      return { ok: true };
    }),
  );

  app.post(
    '/api/admin/login',
    authed((s, a, req, reply) => {
      const t = Date.now();
      const fails = (adminFails.get(a.deviceHash) ?? []).filter((x) => t - x < 15 * MIN);
      if (fails.length >= 5 || !adminGlobal(req.ip)) return deny(reply, 429, 'LOCKED_OUT');
      const given = String((req.body as { pin?: unknown })?.pin ?? '').slice(0, 32);
      if (!verifySecret(given, pin)) {
        adminFails.set(a.deviceHash, [...fails, t]);
        return deny(reply, 403, 'BAD_CODE');
      }
      adminFails.delete(a.deviceHash);
      s.db.prepare('UPDATE devices SET admin_until = ? WHERE token_hash = ?').run(s.now + 8 * 60 * MIN, a.deviceHash);
      s.db.prepare("INSERT INTO events(at, user_id, action) VALUES (?, ?, 'admin_login')").run(s.now, a.userId);
      return { ok: true };
    }),
  );

  app.delete(
    '/api/me',
    authed(async (s, a) => {
      await settle(s, transact(s.db, s.now, (c) => deleteUser(c, a.userId)));
      return { ok: true };
    }),
  );

  return app;
}
