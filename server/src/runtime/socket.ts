import type { Ack, Hello } from '@suds/shared';
import type { Server, Socket } from 'socket.io';
import type { DB } from '../db';
import type { Actor } from '../core/ctx';
import { execCommand, transact } from '../core/engine';
import { authenticate } from '../core/identity';
import { meOf } from '../core/snapshot';
import type { Clock, makeHub } from './hub';

type Hub = ReturnType<typeof makeHub>;

function actorFor(db: DB, deviceHash: string, now: number): Actor | null {
  const d = db.prepare('SELECT user_id, admin_until FROM devices WHERE token_hash = ?').get(deviceHash) as
    | { user_id: number; admin_until: number | null }
    | undefined;
  return d ? { userId: d.user_id, deviceHash, isAdmin: (d.admin_until ?? 0) > now } : null;
}

/** 10 commands per 5 s per connection. */
function bucket() {
  let tokens = 10;
  let last = Date.now();
  return () => {
    const t = Date.now();
    tokens = Math.min(10, tokens + ((t - last) / 5000) * 10);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function attachSockets(io: Server, db: DB, clock: Clock, hub: Hub, vapidPublicKey: string) {
  const sendMe = (s: Socket) => {
    const a = actorFor(db, s.data.deviceHash, clock.now());
    if (!a) return s.disconnect(true);
    s.emit('me', transact(db, clock.now(), (c) => meOf(c, a)).result);
  };
  /** Re-send `me` (admin flag, mute) to every connection, e.g. after an admin mutes someone. */
  const refreshAll = () => {
    for (const s of io.sockets.sockets.values()) sendMe(s);
  };
  const refreshDevice = (deviceHash: string) => {
    for (const s of io.sockets.sockets.values()) if (s.data.deviceHash === deviceHash) sendMe(s);
  };

  io.use((socket, next) => {
    const a = authenticate(db, socket.handshake.auth?.token, clock.now());
    if (!a) return next(new Error('AUTH'));
    socket.data.deviceHash = a.deviceHash;
    socket.data.userId = a.userId;
    next();
  });

  io.on('connection', (socket) => {
    const a = actorFor(db, socket.data.deviceHash, clock.now())!;
    socket.join([`u:${a.userId}`, `d:${a.deviceHash}`]);
    const hello: Hello = {
      me: transact(db, clock.now(), (c) => meOf(c, a)).result,
      serverNow: clock.now(),
      vapidPublicKey,
    };
    socket.emit('hello', hello);
    socket.emit('snapshot', hub.snapshot());
    socket.emit('chat', hub.chat());

    const take = bucket();

    socket.on('time', (ack: unknown) => {
      if (typeof ack === 'function') ack({ serverNow: clock.now() });
    });

    // Phone woke up / tab became visible: send everything again.
    socket.on('sync', () => {
      if (!take()) return;
      sendMe(socket);
      socket.emit('snapshot', hub.snapshot());
      socket.emit('chat', hub.chat());
    });

    socket.on('cmd', (msg: { clientActionId?: unknown; type?: unknown; input?: unknown }, ack: (a: Ack) => void) => {
      if (typeof ack !== 'function') return;
      if (!take()) return ack({ ok: false, code: 'RATE_LIMITED', retryAfterMs: 1000 });
      const { clientActionId, type, input } = msg ?? {};
      if (typeof clientActionId !== 'string' || clientActionId.length > 64 || typeof type !== 'string' || type.length > 32) {
        return ack({ ok: false, code: 'INVALID_INPUT' });
      }
      const actor = actorFor(db, socket.data.deviceHash, clock.now());
      if (!actor) {
        ack({ ok: false, code: 'AUTH' });
        return void socket.disconnect(true);
      }
      // Idempotency: a retried action gets the first answer back.
      const prev = db
        .prepare('SELECT result FROM actions WHERE user_id = ? AND client_action_id = ?')
        .get(actor.userId, clientActionId) as { result: string } | undefined;
      if (prev) return ack(JSON.parse(prev.result));

      let result: Ack;
      try {
        if (type === 'demoForward' || type === 'exitAdmin') {
          result = runtimeCommand(type, actor, input);
        } else {
          const r = execCommand(db, clock.now(), actor, type, input);
          result = r.result;
          hub.after(r);
        }
      } catch (e) {
        console.error('command failed', type, e);
        result = { ok: false, code: 'INTERNAL' };
      }
      db.prepare('INSERT OR IGNORE INTO actions(user_id, client_action_id, result, at) VALUES (?, ?, ?, ?)').run(
        actor.userId,
        clientActionId,
        JSON.stringify(result),
        clock.now(),
      );
      ack(result);
      if (result.ok && type === 'exitAdmin') refreshDevice(actor.deviceHash);
      else if (result.ok && type === 'mute') refreshAll();
    });
  });

  function runtimeCommand(type: string, actor: Actor, input: unknown): Ack {
    if (type === 'exitAdmin') {
      db.prepare('UPDATE devices SET admin_until = NULL WHERE token_hash = ?').run(actor.deviceHash);
      return { ok: true };
    }
    if (!actor.isAdmin) return { ok: false, code: 'NOT_ADMIN' };
    const minutes = Number((input as { minutes?: number })?.minutes);
    if (!clock.demo || !Number.isInteger(minutes) || minutes < 1 || minutes > 600) return { ok: false, code: 'INVALID_INPUT' };
    clock.forward(minutes);
    hub.tick();
    io.emit('snapshot', hub.snapshot());
    io.emit('clock', { serverNow: clock.now() });
    return { ok: true };
  }

  return { refreshDevice, kickUser: (userId: number) => io.in(`u:${userId}`).disconnectSockets(true) };
}
