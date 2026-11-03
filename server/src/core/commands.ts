import { EXTEND_MIN, MAX_EXTENDS, adminCommands, userCommands, type MachineType } from '@suds/shared';
import { z } from 'zod';
import { setConfig } from '../db';
import {
  FREE_PATCH,
  MIN,
  countEvents,
  fail,
  freeMachine,
  frontPosition,
  log,
  machine,
  queueRow,
  setMachine,
  sys,
  userName,
  waitingCount,
  type Actor,
  type Ctx,
  type MachineRow,
} from './ctx';
import { isQuiet, validTimeZone } from './quiet';

type In<S extends z.ZodType> = z.output<S>;
type U = typeof userCommands;
type A = typeof adminCommands;

const ACTIVE = "state IN ('RESERVED','RUNNING','FINISHED')";

function ownsMachine(c: Ctx, userId: number, type: MachineType) {
  return !!c.db
    .prepare(`SELECT 1 FROM machines WHERE owner_id = ? AND type = ? AND retired_at IS NULL AND ${ACTIVE}`)
    .get(userId, type);
}

function isMuted(c: Ctx, userId: number) {
  const r = c.db.prepare('SELECT muted_until FROM users WHERE id = ?').get(userId) as { muted_until: number | null };
  return (r?.muted_until ?? 0) > c.now;
}

function mine(c: Ctx, a: Actor, id: string, state: MachineRow['state']): MachineRow {
  const m = machine(c, id);
  if (m.owner_id !== a.userId) fail(m.state === state ? 'NOT_YOUR_TURN' : 'INVALID_STATE');
  if (m.state !== state) fail('INVALID_STATE');
  return m;
}

/** Leave a line; if you were holding a machine, it goes to the next person. */
function dropSpot(c: Ctx, userId: number, type: MachineType, why: 'leave' | 'give_up' | 'removed') {
  const q = queueRow(c, userId, type) ?? fail('NOT_FOUND');
  if (q.status === 'reserved') {
    const m = c.db
      .prepare("SELECT * FROM machines WHERE owner_id = ? AND type = ? AND state = 'RESERVED'")
      .get(userId, type) as MachineRow | undefined;
    if (m) {
      freeMachine(c, m);
      if (why !== 'removed') sys(c, `${userName(c, userId)} gave up their turn on ${m.label}.`);
    }
  }
  c.db.prepare('DELETE FROM queue WHERE id = ?').run(q.id);
  log(c, why, userId, null, { type });
  c.changed = true;
}

/** Owner lost their machine through no fault of their own → front of the line, counters untouched. */
function compensate(c: Ctx, m: MachineRow) {
  if (m.owner_id == null || (m.state !== 'RESERVED' && m.state !== 'RUNNING')) return;
  const pos = frontPosition(c, m.type);
  const q = queueRow(c, m.owner_id, m.type);
  if (q) {
    c.db
      .prepare("UPDATE queue SET status = 'waiting', position_at = ?, eligible_at = 0, compensation = 1 WHERE id = ?")
      .run(pos, q.id);
  } else {
    c.db
      .prepare(
        'INSERT INTO queue(user_id, type, est_min, joined_at, position_at, compensation) VALUES (?, ?, ?, ?, ?, 1)',
      )
      .run(m.owner_id, m.type, m.est_min ?? c.s.presets[m.type][1], c.now, pos);
  }
}

function confirm(c: Ctx, a: Actor, m: MachineRow, kind: 'out' | 'clear') {
  c.db
    .prepare('DELETE FROM confirmations WHERE machine_id = ? AND kind = ? AND created_at <= ?')
    .run(m.id, kind, c.now - 10 * MIN);
  const dup = c.db
    .prepare('SELECT 1 FROM confirmations WHERE machine_id = ? AND kind = ? AND (user_id = ? OR device_hash = ?)')
    .get(m.id, kind, a.userId, a.deviceHash);
  if (dup) fail('DUPLICATE_CONFIRMATION');
  c.db
    .prepare('INSERT INTO confirmations(machine_id, user_id, device_hash, kind, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(m.id, a.userId, a.deviceHash, kind, c.now);
  log(c, `confirm_${kind}`, a.userId, m.id);
  c.changed = true;
}

const LINK = /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|io|de|co|me|ly|gg|app|dev|xyz|info|link|to|us|uk|fr|nl|ru|tv|sh)\b/i;
const BAD_WORDS = /\b(fuck\w*|shit\w*|bitch\w*|cunt\w*|asshole\w*|dickhead\w*|bastard\w*|slut\w*|whore\w*)\b/gi;
const clean = (t: string) => t.replace(BAD_WORDS, (w) => w[0] + '*'.repeat(w.length - 1));

const user: { [K in keyof U]: (c: Ctx, a: Actor, i: In<U[K]>) => unknown } = {
  join(c, a, { type, estMin }) {
    const b = c.db.prepare('SELECT until FROM blocks WHERE user_id = ? AND type = ? AND until > ?').get(a.userId, type, c.now) as
      | { until: number }
      | undefined;
    if (b) fail('QUEUE_BLOCKED', b.until - c.now);
    if (queueRow(c, a.userId, type) || ownsMachine(c, a.userId, type)) fail('ALREADY_IN_QUEUE');
    if (countEvents(c, a.userId, 'join', 60 * MIN) >= 5) fail('RATE_LIMITED');
    c.db
      .prepare('INSERT INTO queue(user_id, type, est_min, joined_at, position_at) VALUES (?, ?, ?, ?, ?)')
      .run(a.userId, type, estMin, c.now, c.now);
    log(c, 'join', a.userId, null, { type, estMin });
    c.changed = true;
  },

  leave(c, a, { type }) {
    dropSpot(c, a.userId, type, 'leave');
  },

  startNow(c, a, { machineId, estMin }) {
    const m = machine(c, machineId);
    if (m.state !== 'FREE') fail(m.state === 'RESERVED' || m.state === 'RUNNING' ? 'ALREADY_CLAIMED' : 'INVALID_STATE');
    if (ownsMachine(c, a.userId, m.type)) fail('ALREADY_IN_QUEUE');
    if (!isQuiet(c.now, c.s) && waitingCount(c, m.type) > 0) fail('NOT_YOUR_TURN');
    // During quiet hours machines are first come, first served; using one uses up your spot.
    c.db.prepare('DELETE FROM queue WHERE user_id = ? AND type = ?').run(a.userId, m.type);
    setMachine(c, m.id, {
      ...FREE_PATCH,
      state: 'RUNNING',
      owner_id: a.userId,
      started_at: c.now,
      ends_at: c.now + estMin * MIN,
      est_min: estMin,
    });
    log(c, 'start', a.userId, m.id, { estMin, walkup: true });
  },

  loaded(c, a, { machineId }) {
    const m = mine(c, a, machineId, 'RESERVED');
    setMachine(c, m.id, {
      state: 'RUNNING',
      reserved_until: null,
      started_at: c.now,
      ends_at: c.now + m.est_min! * MIN,
    });
    c.db.prepare('DELETE FROM queue WHERE user_id = ? AND type = ?').run(a.userId, m.type);
    log(c, 'start', a.userId, m.id, { estMin: m.est_min });
  },

  snooze(c, a, { machineId }) {
    const m = mine(c, a, machineId, 'RESERVED');
    if (m.snooze_used) fail('INVALID_STATE');
    setMachine(c, m.id, { reserved_until: m.reserved_until! + c.s.snoozeMin * MIN, snooze_used: 1 }, false);
    log(c, 'snooze', a.userId, m.id);
  },

  giveUp(c, a, { machineId }) {
    const m = mine(c, a, machineId, 'RESERVED');
    dropSpot(c, a.userId, m.type, 'give_up');
  },

  notEmpty(c, a, { machineId }) {
    const m = mine(c, a, machineId, 'RESERVED');
    compensate(c, m);
    setMachine(c, m.id, {
      ...FREE_PATCH,
      state: 'OCCUPIED_UNKNOWN',
      started_at: c.now,
      ends_at: c.now + 45 * MIN,
      est_min: 45,
    });
    sys(c, `${m.label} still has clothes in it, so it's marked as in use. ${userName(c, a.userId)} keeps their place at the front.`);
    log(c, 'not_empty', a.userId, m.id);
  },

  extend(c, a, { machineId, minutes }) {
    const m = mine(c, a, machineId, 'RUNNING');
    if (m.ext_used + minutes > MAX_EXTENDS * EXTEND_MIN) fail('CAP_REACHED');
    const ends = m.ends_at! + minutes * MIN;
    const total = Math.round((ends - m.started_at!) / MIN);
    if (total > c.s.capMin) fail('CAP_REACHED');
    const over = total > (m.est_min ?? 0) + EXTEND_MIN && !m.overrun_noticed;
    setMachine(c, m.id, { ends_at: ends, ext_used: m.ext_used + minutes, overrun_noticed: over ? 1 : m.overrun_noticed }, false);
    if (over) sys(c, `${userName(c, a.userId)} extended ${m.label} to ${total} min (estimate was ${m.est_min}).`);
    log(c, 'extend', a.userId, m.id, { minutes });
  },

  finishEarly(c, a, { machineId }) {
    const m = mine(c, a, machineId, 'RUNNING');
    setMachine(c, m.id, { state: 'FINISHED', finished_at: c.now, ends_at: c.now });
    log(c, 'finish_early', a.userId, m.id);
  },

  collect(c, a, { machineId }) {
    const m = machine(c, machineId);
    if (m.owner_id !== a.userId) fail('NOT_YOUR_TURN');
    if (m.state !== 'FINISHED' && m.state !== 'RUNNING') fail('INVALID_STATE');
    freeMachine(c, m);
    log(c, 'collect', a.userId, m.id);
  },

  confirmOut(c, a, { machineId }) {
    const m = machine(c, machineId);
    if (m.state !== 'FINISHED' || m.owner_id === a.userId) fail('INVALID_STATE');
    if (!m.owner_pinged_at || c.now < m.owner_pinged_at + 5 * MIN) fail('TOO_EARLY');
    confirm(c, a, m, 'out');
  },

  markOccupied(c, a, { machineId }) {
    if (isMuted(c, a.userId)) fail('MUTED');
    const m = machine(c, machineId);
    if (m.state !== 'FREE') fail('INVALID_STATE');
    setMachine(c, m.id, { state: 'OCCUPIED_UNKNOWN', started_at: c.now, ends_at: c.now + 45 * MIN, est_min: 45 });
    log(c, 'mark_occupied', a.userId, m.id);
  },

  confirmClear(c, a, { machineId }) {
    const m = machine(c, machineId);
    if (m.state !== 'OCCUPIED_UNKNOWN') fail('INVALID_STATE');
    if (a.isAdmin) {
      freeMachine(c, m);
      log(c, 'cleared', a.userId, m.id, { admin: true });
      return;
    }
    confirm(c, a, m, 'clear');
  },

  reportBroken(c, a, { machineId, note }) {
    if (isMuted(c, a.userId)) fail('MUTED');
    const m = machine(c, machineId);
    if (m.state === 'OUT_OF_ORDER') fail('INVALID_STATE');
    compensate(c, m);
    setMachine(c, m.id, { ...FREE_PATCH, state: 'OUT_OF_ORDER', note: note || null });
    c.db.prepare('DELETE FROM confirmations WHERE machine_id = ?').run(m.id);
    sys(c, `${m.label} was reported out of order${note ? `: “${note}”` : '.'}`);
    log(c, 'report_broken', a.userId, m.id, { note, was: m.state, owner: m.owner_id });
  },

  markFixed(c, a, { machineId }) {
    const m = machine(c, machineId);
    if (m.state !== 'OUT_OF_ORDER') fail('INVALID_STATE');
    freeMachine(c, m);
    sys(c, `${m.label} is fixed and back in service.`);
    log(c, 'mark_fixed', a.userId, m.id);
  },

  sendMessage(c, a, { text, announce }) {
    if (isMuted(c, a.userId)) fail('MUTED');
    if (announce && !a.isAdmin) fail('NOT_ADMIN');
    const last = c.db
      .prepare('SELECT text, created_at FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT 1')
      .get(a.userId) as { text: string; created_at: number } | undefined;
    if (last && c.now - last.created_at < 2000) fail('RATE_LIMITED', 2000 - (c.now - last.created_at));
    if (last && last.text === clean(text) && c.now - last.created_at < 60_000) fail('RATE_LIMITED');
    if (!c.s.linksAllowed && LINK.test(text)) fail('LINKS_BLOCKED');
    c.db
      .prepare('INSERT INTO messages(user_id, kind, text, pinned_until, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(a.userId, announce ? 'announcement' : 'normal', clean(text), announce ? c.now + 24 * 60 * MIN : null, c.now);
    if (announce) {
      // Max 3 pinned: unpin the oldest beyond that.
      c.db
        .prepare(
          `UPDATE messages SET pinned_until = NULL WHERE id IN (
             SELECT id FROM messages WHERE pinned_until > ? AND deleted = 0 ORDER BY id DESC LIMIT -1 OFFSET 3)`,
        )
        .run(c.now);
    }
    c.chatChanged = true;
  },

  reportMessage(c, a, { messageId }) {
    if (isMuted(c, a.userId)) fail('MUTED');
    const seen = c.db
      .prepare("SELECT 1 FROM events WHERE user_id = ? AND action = 'report_message' AND detail = ?")
      .get(a.userId, JSON.stringify({ messageId }));
    if (seen) fail('DUPLICATE_CONFIRMATION');
    const r = c.db.prepare('UPDATE messages SET reports = reports + 1 WHERE id = ? AND deleted = 0').run(messageId);
    if (!r.changes) fail('NOT_FOUND');
    log(c, 'report_message', a.userId, null, { messageId });
    c.chatChanged = true;
  },
};

const admin: { [K in keyof A]: (c: Ctx, a: Actor, i: In<A[K]>) => unknown } = {
  forceFree(c, a, { machineId }) {
    const m = machine(c, machineId);
    if (m.state === 'RESERVED' && m.owner_id != null) compensate(c, m);
    freeMachine(c, m);
    sys(c, `An admin freed ${m.label}.`);
    log(c, 'admin_force_free', a.userId, m.id, { was: m.state, owner: m.owner_id });
  },

  removeFromQueue(c, a, { userId, type }) {
    dropSpot(c, userId, type, 'removed');
    log(c, 'admin_remove', a.userId, null, { userId, type });
  },

  deleteMessage(c, a, { messageId }) {
    c.db.prepare('UPDATE messages SET deleted = 1 WHERE id = ?').run(messageId);
    log(c, 'admin_delete_message', a.userId, null, { messageId });
    c.chatChanged = true;
  },

  unpin(c, a, { messageId }) {
    c.db.prepare('UPDATE messages SET pinned_until = NULL WHERE id = ?').run(messageId);
    log(c, 'admin_unpin', a.userId, null, { messageId });
    c.chatChanged = true;
  },

  mute(c, a, { userId, minutes }) {
    c.db.prepare('UPDATE users SET muted_until = ? WHERE id = ?').run(minutes ? c.now + minutes * MIN : null, userId);
    log(c, minutes ? 'admin_mute' : 'admin_unmute', a.userId, null, { userId, minutes });
  },

  setSettings(c, a, input) {
    if (!validTimeZone(input.tz)) fail('INVALID_INPUT');
    c.s = { ...c.s, ...input };
    setConfig(c.db, 'settings', JSON.stringify(c.s));
    log(c, 'admin_settings', a.userId, null, input);
    c.changed = true;
  },

  addMachine(c, a, { type, label }) {
    const ids = c.db.prepare('SELECT id FROM machines WHERE type = ?').all(type) as { id: string }[];
    const n = Math.max(0, ...ids.map((r) => Number(r.id.slice(1)) || 0)) + 1;
    const sort = (c.db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 s FROM machines').get() as { s: number }).s;
    const id = `${type[0]}${n}`;
    c.db.prepare('INSERT INTO machines(id, type, label, sort) VALUES (?, ?, ?, ?)').run(id, type, label, sort);
    sys(c, `New ${type} added: ${label}.`);
    log(c, 'admin_add_machine', a.userId, id, { type, label });
    c.changed = true;
    return { id };
  },

  renameMachine(c, a, { machineId, label }) {
    const m = machine(c, machineId);
    setMachine(c, m.id, { label }, false);
    log(c, 'admin_rename_machine', a.userId, m.id, { from: m.label, to: label });
  },

  moveMachine(c, a, { machineId, dir }) {
    const m = machine(c, machineId);
    const list = c.db
      .prepare('SELECT id, sort FROM machines WHERE type = ? AND retired_at IS NULL ORDER BY sort, id')
      .all(m.type) as { id: string; sort: number }[];
    const i = list.findIndex((x) => x.id === m.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    // Renumber so equal sort values can't get stuck.
    [list[i], list[j]] = [list[j], list[i]];
    const base = Math.min(...list.map((x) => x.sort));
    const upd = c.db.prepare('UPDATE machines SET sort = ? WHERE id = ?');
    list.forEach((x, k) => upd.run(base + k, x.id));
    log(c, 'admin_move_machine', a.userId, m.id, { dir });
    c.changed = true;
  },

  retireMachine(c, a, { machineId }) {
    const m = machine(c, machineId);
    if (m.state !== 'FREE' && m.state !== 'OUT_OF_ORDER') fail('INVALID_STATE');
    setMachine(c, m.id, { ...FREE_PATCH, retired_at: c.now });
    sys(c, `${m.label} was removed from service.`);
    log(c, 'admin_retire_machine', a.userId, m.id);
  },

  restoreMachine(c, a, { machineId }) {
    const r = c.db.prepare('SELECT * FROM machines WHERE id = ? AND retired_at IS NOT NULL').get(machineId) as
      | MachineRow
      | undefined;
    if (!r) fail('NOT_FOUND');
    setMachine(c, machineId, { ...FREE_PATCH, retired_at: null });
    sys(c, `${r!.label} is back in service.`);
    log(c, 'admin_restore_machine', a.userId, machineId);
  },

  listUsers(c) {
    return c.db
      .prepare('SELECT id, name, emoji, room, muted_until AS mutedUntil, last_active AS lastActive FROM users ORDER BY room, name_lower')
      .all();
  },

  listRetired(c) {
    return c.db.prepare('SELECT id, type, label, retired_at AS retiredAt FROM machines WHERE retired_at IS NOT NULL').all();
  },

  auditLog(c, _a, { before, limit }) {
    return c.db
      .prepare(
        `SELECT e.id, e.at, e.action, e.machine_id AS machineId, e.detail, u.name AS userName
         FROM events e LEFT JOIN users u ON u.id = e.user_id
         WHERE e.id < ? ORDER BY e.id DESC LIMIT ?`,
      )
      .all(before ?? Number.MAX_SAFE_INTEGER, limit);
  },

  // Handled by the runtime (they touch the clock / the device), listed so the schema map is complete.
  demoForward() {},
  exitAdmin() {},
};

/** Validate and run one command. Throws CommandError. */
export function runCommand(c: Ctx, a: Actor, name: string, input: unknown): unknown {
  if (name in user) {
    const k = name as keyof U;
    const parsed = userCommands[k].safeParse(input ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    return (user[k] as (c: Ctx, a: Actor, i: unknown) => unknown)(c, a, parsed.data);
  }
  if (name in admin) {
    if (!a.isAdmin) fail('NOT_ADMIN');
    const k = name as keyof A;
    const parsed = adminCommands[k].safeParse(input ?? {});
    if (!parsed.success) fail('INVALID_INPUT');
    return (admin[k] as (c: Ctx, a: Actor, i: unknown) => unknown)(c, a, parsed.data);
  }
  return fail('INVALID_INPUT');
}
