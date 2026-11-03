import type { ErrorCode, MachineState, MachineType, Settings } from '@suds/shared';
import { getConfig, type DB } from '../db';

export const MIN = 60_000;

export class CommandError extends Error {
  constructor(
    public code: ErrorCode,
    public retryAfterMs?: number,
  ) {
    super(code);
  }
}

/** One unit of work against the database at a fixed point in time. */
export interface Ctx {
  db: DB;
  now: number;
  s: Settings;
  /** machine/queue state changed → broadcast a new snapshot */
  changed: boolean;
  /** messages changed → broadcast the board */
  chatChanged: boolean;
}

export interface Actor {
  userId: number;
  deviceHash: string;
  isAdmin: boolean;
}

export interface MachineRow {
  id: string;
  type: MachineType;
  label: string;
  state: MachineState;
  owner_id: number | null;
  reserved_until: number | null;
  snooze_used: number;
  started_at: number | null;
  ends_at: number | null;
  finished_at: number | null;
  est_min: number | null;
  ext_used: number;
  overrun_noticed: number;
  owner_pinged_at: number | null;
  note: string | null;
  version: number;
  sort: number;
  retired_at: number | null;
}

export interface QueueRow {
  id: number;
  user_id: number;
  type: MachineType;
  est_min: number;
  joined_at: number;
  position_at: number;
  status: 'waiting' | 'reserved';
  missed_count: number;
  eligible_at: number;
  compensation: number;
}

export function makeCtx(db: DB, now: number): Ctx {
  return { db, now, s: JSON.parse(getConfig(db, 'settings')!), changed: false, chatChanged: false };
}

export const fail = (code: ErrorCode, retryAfterMs?: number): never => {
  throw new CommandError(code, retryAfterMs);
};

export function activeMachines(c: Ctx): MachineRow[] {
  return c.db
    .prepare('SELECT * FROM machines WHERE retired_at IS NULL ORDER BY type DESC, sort, id')
    .all() as unknown as MachineRow[];
}

export function machine(c: Ctx, id: string): MachineRow {
  const m = c.db.prepare('SELECT * FROM machines WHERE id = ? AND retired_at IS NULL').get(id) as MachineRow | undefined;
  return m ?? fail('NOT_FOUND');
}

export const FREE_PATCH = {
  state: 'FREE',
  owner_id: null,
  reserved_until: null,
  snooze_used: 0,
  started_at: null,
  ends_at: null,
  finished_at: null,
  est_min: null,
  ext_used: 0,
  overrun_noticed: 0,
  owner_pinged_at: null,
  note: null,
} satisfies Partial<MachineRow>;

/** Patch a machine row. `bump` marks a new state "instance" (push dedupe keys use it). */
export function setMachine(c: Ctx, id: string, patch: Partial<MachineRow>, bump = true) {
  const keys = Object.keys(patch);
  c.db
    .prepare(
      `UPDATE machines SET ${keys.map((k) => `${k} = @${k}`).join(', ')}${bump ? ', version = version + 1' : ''} WHERE id = @__id`,
    )
    .run({ ...patch, __id: id });
  c.changed = true;
}

export function freeMachine(c: Ctx, m: MachineRow) {
  setMachine(c, m.id, FREE_PATCH);
  c.db.prepare('DELETE FROM confirmations WHERE machine_id = ?').run(m.id);
}

export function userName(c: Ctx, id: number | null): string {
  if (id == null) return 'Someone';
  return (
    (c.db.prepare('SELECT name FROM users WHERE id = ?').get(id) as { name: string } | undefined)?.name ?? 'Someone'
  );
}

export function queueRow(c: Ctx, userId: number, type: MachineType): QueueRow | undefined {
  return c.db.prepare('SELECT * FROM queue WHERE user_id = ? AND type = ?').get(userId, type) as QueueRow | undefined;
}

export function waitingCount(c: Ctx, type: MachineType): number {
  return (c.db.prepare("SELECT COUNT(*) n FROM queue WHERE type = ? AND status = 'waiting'").get(type) as { n: number })
    .n;
}

/** Position key that puts someone in front of everyone currently in line. */
export function frontPosition(c: Ctx, type: MachineType): number {
  const r = c.db.prepare('SELECT MIN(position_at) p FROM queue WHERE type = ?').get(type) as { p: number | null };
  return r.p == null ? c.now : Math.min(r.p - 1, c.now);
}

export function log(c: Ctx, action: string, userId: number | null, machineId: string | null = null, detail?: unknown) {
  c.db
    .prepare('INSERT INTO events(at, user_id, machine_id, action, detail) VALUES (?, ?, ?, ?, ?)')
    .run(c.now, userId, machineId, action, detail === undefined ? null : JSON.stringify(detail));
}

/** Post a system message on the board. */
export function sys(c: Ctx, text: string) {
  c.db.prepare("INSERT INTO messages(kind, text, created_at) VALUES ('system', ?, ?)").run(text.slice(0, 400), c.now);
  c.chatChanged = true;
}

export function countEvents(c: Ctx, userId: number, action: string, sinceMs: number): number {
  return (
    c.db
      .prepare('SELECT COUNT(*) n FROM events WHERE user_id = ? AND action = ? AND at > ?')
      .get(userId, action, c.now - sinceMs) as { n: number }
  ).n;
}

export function validConfirmations(c: Ctx, machineId: string, kind: 'out' | 'clear') {
  return c.db
    .prepare('SELECT user_id, device_hash FROM confirmations WHERE machine_id = ? AND kind = ? AND created_at > ?')
    .all(machineId, kind, c.now - 10 * MIN) as { user_id: number; device_hash: string }[];
}

/** Two different users on two different devices. */
export function confirmed(c: Ctx, machineId: string, kind: 'out' | 'clear') {
  const rows = validConfirmations(c, machineId, kind);
  return new Set(rows.map((r) => r.device_hash)).size >= 2 && new Set(rows.map((r) => r.user_id)).size >= 2;
}
