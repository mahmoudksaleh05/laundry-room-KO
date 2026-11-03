import type { Ack } from '@suds/shared';
import type { DB } from '../db';
import { advance } from './advance';
import { runCommand } from './commands';
import { CommandError, makeCtx, type Actor, type Ctx } from './ctx';

export interface TxResult<T> {
  result: T;
  changed: boolean;
  chatChanged: boolean;
}

/** advance → fn → advance, in one IMMEDIATE transaction. Throws roll everything back. */
export function transact<T>(db: DB, now: number, fn: (c: Ctx) => T): TxResult<T> {
  const c = makeCtx(db, now);
  db.exec('BEGIN IMMEDIATE');
  let result: T;
  try {
    advance(c);
    result = fn(c);
    advance(c);
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return { result, changed: c.changed, chatChanged: c.chatChanged };
}

/**
 * Run a command. Time-driven changes are committed first on their own, so a
 * rejected command never rolls back e.g. an expired window being handed on.
 */
export function execCommand(db: DB, now: number, a: Actor, name: string, input: unknown): TxResult<Ack> {
  const pre = transact(db, now, () => undefined);
  try {
    const r = transact(db, now, (c) => runCommand(c, a, name, input));
    const data = r.result;
    return {
      result: data === undefined ? { ok: true } : { ok: true, data },
      changed: pre.changed || r.changed,
      chatChanged: pre.chatChanged || r.chatChanged,
    };
  } catch (e) {
    if (!(e instanceof CommandError)) throw e;
    return {
      result: { ok: false, code: e.code, ...(e.retryAfterMs ? { retryAfterMs: e.retryAfterMs } : {}) },
      changed: pre.changed,
      chatChanged: pre.chatChanged,
    };
  }
}
