import { MIN, activeMachines, waitingCount, type Ctx, type QueueRow } from './ctx';
import { isQuiet } from './quiet';

export interface PushIntent {
  key: string;
  userId: number;
  title: string;
  body: string;
}

const fmtTime = (t: number, tz: string) =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(t);

/**
 * Pushes are derived from the current state rather than scheduled: each tick
 * we list what *should* have been sent by now, and send whatever isn't in
 * push_log yet. A push whose situation changed simply stops being "due".
 * Returns only the new ones and records them as sent.
 */
export function duePushes(c: Ctx): PushIntent[] {
  if (isQuiet(c.now, c.s)) return [];
  const due: PushIntent[] = [];
  const machines = activeMachines(c);

  for (const m of machines) {
    const uid = m.owner_id;
    if (uid == null) continue;
    if (m.state === 'RESERVED') {
      due.push({ key: `turn:${m.id}:${m.version}`, userId: uid, title: "It's your turn! ⏳", body: `${m.label} is held for you for ${c.s.windowMin} minutes.` });
      if (m.reserved_until! - c.now <= 2 * MIN)
        due.push({ key: `turn2:${m.id}:${m.version}:${m.reserved_until}`, userId: uid, title: '2 minutes left', body: `Start ${m.label} now or it goes to the next person.` });
    } else if (m.state === 'RUNNING') {
      if (m.ends_at! - c.now <= 5 * MIN)
        due.push({ key: `five:${m.id}:${m.version}:${m.ends_at}`, userId: uid, title: 'Almost done', body: `${m.label} finishes at ${fmtTime(m.ends_at!, c.s.tz)}.` });
    } else if (m.state === 'FINISHED') {
      due.push({ key: `done:${m.id}:${m.version}`, userId: uid, title: 'Your laundry is done 🔔', body: `Please collect it from ${m.label}.` });
      if (c.now >= m.finished_at! + 10 * MIN) {
        const someone = waitingCount(c, m.type) > 0;
        due.push({
          key: `rem:${m.id}:${m.version}`,
          userId: uid,
          title: someone ? 'Someone is waiting for your machine' : 'Reminder: laundry is done',
          body: someone ? `Please collect your clothes from ${m.label}. Others can move them in 5 minutes.` : `Your clothes are still in ${m.label}.`,
        });
      }
    }
  }

  // "You're next": first in line while a machine of that type is about to free up.
  for (const type of ['washer', 'dryer'] as const) {
    const head = c.db
      .prepare("SELECT * FROM queue WHERE type = ? AND status = 'waiting' ORDER BY (eligible_at > ?) ASC, position_at, id LIMIT 1")
      .get(type, c.now) as QueueRow | undefined;
    if (!head) continue;
    const soon = machines.some(
      (m) => m.type === type && ((m.state === 'RUNNING' && m.ends_at! - c.now <= 5 * MIN) || m.state === 'FINISHED'),
    );
    if (soon)
      due.push({ key: `next:${head.id}:${head.position_at}`, userId: head.user_id, title: "You're next 🧺", body: `A ${type} is about to free up. Get ready.` });
  }

  // Clothes moved out by others (from the audit log; the machine is already free).
  const moved = c.db
    .prepare("SELECT e.id, e.detail, m.label FROM events e JOIN machines m ON m.id = e.machine_id WHERE e.action = 'moved' AND e.at > ?")
    .all(c.now - 10 * MIN) as { id: number; detail: string; label: string }[];
  for (const e of moved) {
    const d = JSON.parse(e.detail) as { owner: number | null; by: string[] };
    if (d.owner != null)
      due.push({ key: `moved:${e.id}`, userId: d.owner, title: 'Your clothes were moved', body: `${d.by.join(' and ')} moved your clothes out of ${e.label}.` });
  }

  const seen = c.db.prepare('SELECT 1 FROM push_log WHERE key = ?');
  const mark = c.db.prepare('INSERT INTO push_log(key, at) VALUES (?, ?)');
  return due.filter((p) => {
    if (seen.get(p.key)) return false;
    mark.run(p.key, c.now);
    return true;
  });
}
