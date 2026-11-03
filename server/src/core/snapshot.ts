import type { ChatMessage, Me, MachineView, QueueEntry, Snapshot } from '@suds/shared';
import { MIN, activeMachines, type Actor, type Ctx } from './ctx';
import { isQuiet } from './quiet';

export function buildSnapshot(c: Ctx, demo: boolean): Snapshot {
  const users = new Map(
    (c.db.prepare('SELECT id, name, emoji FROM users').all() as { id: number; name: string; emoji: string }[]).map((u) => [u.id, u]),
  );
  const conf = c.db
    .prepare('SELECT machine_id, user_id FROM confirmations WHERE created_at > ?')
    .all(c.now - 10 * MIN) as { machine_id: string; user_id: number }[];

  const machines: MachineView[] = activeMachines(c).map((m) => ({
    id: m.id,
    type: m.type,
    label: m.label,
    state: m.state,
    owner: m.owner_id != null ? (users.get(m.owner_id) ?? null) : null,
    reservedUntil: m.reserved_until,
    startedAt: m.started_at,
    endsAt: m.ends_at,
    finishedAt: m.finished_at,
    estMin: m.est_min,
    extUsed: m.ext_used,
    snoozeUsed: !!m.snooze_used,
    note: m.note,
    confirmedBy: conf.filter((x) => x.machine_id === m.id).map((x) => x.user_id),
    confirmUnlockAt: m.owner_pinged_at ? m.owner_pinged_at + 5 * MIN : null,
  }));

  const rows = c.db
    .prepare('SELECT * FROM queue ORDER BY (eligible_at > ?) ASC, position_at, id')
    .all(c.now) as {
    user_id: number;
    type: 'washer' | 'dryer';
    est_min: number;
    status: 'waiting' | 'reserved';
    missed_count: number;
    compensation: number;
    eligible_at: number;
  }[];
  const queues: Snapshot['queues'] = { washer: [], dryer: [] };
  for (const q of rows) {
    const u = users.get(q.user_id);
    const e: QueueEntry = {
      userId: q.user_id,
      name: u?.name ?? '?',
      emoji: u?.emoji ?? '🧺',
      estMin: q.est_min,
      status: q.status,
      missed: q.missed_count,
      compensation: !!q.compensation,
      eligibleAt: q.eligible_at,
    };
    queues[q.type].push(e);
  }

  const blocks = (
    c.db.prepare('SELECT user_id, type, until FROM blocks WHERE until > ?').all(c.now) as {
      user_id: number;
      type: 'washer' | 'dryer';
      until: number;
    }[]
  ).map((b) => ({ userId: b.user_id, type: b.type, until: b.until }));

  return { serverNow: c.now, machines, queues, blocks, quiet: isQuiet(c.now, c.s), settings: c.s, demo };
}

export function chatList(c: Ctx): ChatMessage[] {
  const rows = c.db
    .prepare(
      `SELECT m.id, m.kind, m.text, m.created_at, m.pinned_until, m.reports, u.id AS uid, u.name, u.emoji
       FROM messages m LEFT JOIN users u ON u.id = m.user_id
       WHERE m.deleted = 0 AND m.created_at > ?
       ORDER BY m.id DESC LIMIT 200`,
    )
    .all(c.now - 48 * 60 * MIN) as {
    id: number;
    kind: ChatMessage['kind'];
    text: string;
    created_at: number;
    pinned_until: number | null;
    reports: number;
    uid: number | null;
    name: string | null;
    emoji: string | null;
  }[];
  return rows.reverse().map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.text,
    at: r.created_at,
    user: r.uid != null ? { id: r.uid, name: r.name!, emoji: r.emoji! } : null,
    pinnedUntil: r.pinned_until && r.pinned_until > c.now ? r.pinned_until : null,
    reports: r.reports,
  }));
}

export function meOf(c: Ctx, a: Actor): Me {
  const u = c.db.prepare('SELECT id, name, emoji, muted_until FROM users WHERE id = ?').get(a.userId) as {
    id: number;
    name: string;
    emoji: string;
    muted_until: number | null;
  };
  return { id: u.id, name: u.name, emoji: u.emoji, isAdmin: a.isAdmin, mutedUntil: u.muted_until };
}

/** Retention: chat 200 msgs / 48 h, audit 30 days, short-lived bookkeeping. */
export function housekeeping(c: Ctx) {
  const day = 24 * 60 * MIN;
  c.db.prepare('DELETE FROM messages WHERE created_at < ?').run(c.now - 2 * day);
  c.db.prepare('DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT 400)').run();
  c.db.prepare('DELETE FROM events WHERE at < ?').run(c.now - 30 * day);
  c.db.prepare('DELETE FROM actions WHERE at < ?').run(c.now - 60 * MIN);
  c.db.prepare('DELETE FROM push_log WHERE at < ?').run(c.now - day);
  c.db.prepare('DELETE FROM confirmations WHERE created_at < ?').run(c.now - 10 * MIN);
  c.db.prepare('DELETE FROM blocks WHERE until < ?').run(c.now);
  // Users nobody has seen in 60 days and who hold nothing: frees their name.
  c.db
    .prepare(
      `DELETE FROM users WHERE last_active < ?
       AND id NOT IN (SELECT user_id FROM queue) AND id NOT IN (SELECT owner_id FROM machines WHERE owner_id IS NOT NULL)`,
    )
    .run(c.now - 60 * day);
}
