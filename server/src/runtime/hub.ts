import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Server } from 'socket.io';
import type { DB } from '../db';
import { transact, type TxResult } from '../core/engine';
import { duePushes } from '../core/pushes';
import { buildSnapshot, chatList, housekeeping } from '../core/snapshot';
import { sendPushes } from './push';

/** Real clock, or (DEMO=1) a clock admins can fast-forward. */
export function makeClock(demo: boolean) {
  let offset = 0;
  return {
    demo,
    now: () => Date.now() + offset,
    forward(min: number) {
      if (!demo) throw new Error('not in demo mode');
      offset += min * 60_000;
    },
  };
}
export type Clock = ReturnType<typeof makeClock>;

/** Applies the side effects of a committed transaction: broadcasts and pushes. */
export function makeHub(db: DB, clock: Clock, io: Server) {
  const snapshot = () => transact(db, clock.now(), (c) => buildSnapshot(c, clock.demo)).result;
  const chat = () => transact(db, clock.now(), (c) => chatList(c)).result;

  function after(r: Pick<TxResult<unknown>, 'changed' | 'chatChanged'>) {
    if (r.changed) io.emit('snapshot', snapshot());
    if (r.chatChanged) io.emit('chat', chat());
    const due = transact(db, clock.now(), (c) => duePushes(c)).result;
    if (due.length) void sendPushes(db, due, clock.now());
  }

  let ticks = 0;
  function tick() {
    try {
      after(transact(db, clock.now(), () => undefined));
      if (ticks++ % 60 === 0) {
        after(transact(db, clock.now(), (c) => housekeeping(c)));
        backup();
      }
    } catch (e) {
      console.error('tick failed', e);
    }
  }

  return { snapshot, chat, after, tick };

  function backup() {
    const dir = join(dbDir(db), 'backups');
    const day = new Date().toISOString().slice(0, 10);
    const file = join(dir, `sudsqueue-${day}.db`);
    if (db.memory || existsSync(file)) return;
    mkdirSync(dir, { recursive: true });
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -7);
    for (const f of old) rmSync(join(dir, f));
  }
}

const dbDir = (db: DB) => db.name.replace(/[\\/][^\\/]+$/, '');
