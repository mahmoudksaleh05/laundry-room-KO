import type { ChatMessage, Snapshot } from '@suds/shared';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import postgres from 'postgres';
import { getConfig, openDb, type DB } from '../db';
import { env } from './env';

export interface PublicState {
  snapshot: Snapshot;
  chat: ChatMessage[];
}

/** What every request gets: the database, the current time, and a way to publish the board. */
export interface Session {
  db: DB;
  now: number;
  /** Push the latest state to every open phone (Supabase Realtime). */
  publish(state: PublicState): void;
  /** Keep today's copy of the database (kept 7 days). */
  backup(): void;
}

type Work<T> = (s: Session) => T | Promise<T>;

/** DEMO=1 lets admins move the clock forward; the offset lives in the database. */
const clockOf = (db: DB) => Date.now() + (env.demo ? Number(getConfig(db, 'clock_offset') ?? 0) : 0);

// ── Local: one SQLite file, requests run one at a time ──────────────────────
let localDb: DB | undefined;
let queue: Promise<unknown> = Promise.resolve();
function local<T>(work: Work<T>): Promise<T> {
  const run = queue.then(() => {
    if (!localDb) {
      mkdirSync(dirname(env.dbFile), { recursive: true });
      localDb = openDb(env.dbFile, env.tz);
    }
    return work({ db: localDb, now: clockOf(localDb), publish: () => {}, backup: () => {} });
  });
  queue = run.catch(() => {});
  return run;
}

// ── Vercel: the SQLite file is one locked row in Postgres ───────────────────
// shortcut: the whole dorm database is loaded per request (a few hundred KB),
// fine for one dorm; move tables to Postgres proper if it ever grows past ~5 MB.
let sql: postgres.Sql | undefined;
async function remote<T>(work: Work<T>): Promise<T> {
  sql ??= postgres(env.databaseUrl!, { max: 1, prepare: false, idle_timeout: 20 });
  return sql.begin(async (tx) => {
    const [row] = await tx<{ data: Buffer }[]>`SELECT data FROM laundry.store WHERE id = 1 FOR UPDATE`;
    const file = join(tmpdir(), `suds-${randomUUID()}.db`);
    if (row) writeFileSync(file, row.data);
    const db = openDb(file, env.tz);
    let open = true;
    let published: PublicState | undefined;
    let backup = false;
    try {
      const result = await work({ db, now: clockOf(db), publish: (s) => (published = s), backup: () => (backup = true) });
      const { n } = db.prepare('SELECT total_changes() AS n').get() as { n: number };
      db.close();
      open = false;
      if (n > 0 || !row) {
        const data = readFileSync(file);
        await tx`INSERT INTO laundry.store(id, data) VALUES (1, ${data})
                 ON CONFLICT (id) DO UPDATE SET data = excluded.data, updated_at = now()`;
        if (backup) {
          await tx`INSERT INTO laundry.backups(day, data) VALUES (current_date, ${data}) ON CONFLICT (day) DO NOTHING`;
          await tx`DELETE FROM laundry.backups WHERE day < current_date - 7`;
        }
      }
      if (published) {
        const p = published as PublicState;
        await tx`INSERT INTO laundry.state(id, snapshot, chat) VALUES (1, ${tx.json(p.snapshot as never)}, ${tx.json(p.chat as never)})
                 ON CONFLICT (id) DO UPDATE SET snapshot = excluded.snapshot, chat = excluded.chat, updated_at = now()`;
      }
      return result;
    } finally {
      if (open) db.close();
      rmSync(file, { force: true });
    }
  }) as Promise<T>;
}

/** Run one request against the dorm database, serialised with every other request. */
export const withDb = <T>(work: Work<T>): Promise<T> => (env.databaseUrl ? remote(work) : local(work));
