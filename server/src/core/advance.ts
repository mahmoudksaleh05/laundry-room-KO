import {
  MIN,
  activeMachines,
  confirmed,
  freeMachine,
  log,
  queueRow,
  setMachine,
  sys,
  userName,
  validConfirmations,
  waitingCount,
  type Ctx,
  type MachineRow,
  type QueueRow,
} from './ctx';
import { isQuiet } from './quiet';

/**
 * Move every machine forward to `c.now`: finish cycles, expire turn windows,
 * hand free machines to the head of the line. Runs to a fixed point, so one
 * call settles chains like "window expired → next person reserved".
 * Pure function of the database and `c.now` — the scheduler, the boot sequence
 * and every command call it the same way.
 */
export function advance(c: Ctx) {
  for (let i = 0; i < 200; i++) if (!step(c)) return;
  throw new Error('advance() did not settle');
}

function step(c: Ctx): boolean {
  const quiet = isQuiet(c.now, c.s);
  for (const m of activeMachines(c)) {
    switch (m.state) {
      case 'RUNNING':
        if (c.now >= m.ends_at!) {
          setMachine(c, m.id, { state: 'FINISHED', finished_at: m.ends_at });
          sys(c, `${userName(c, m.owner_id)}'s laundry in ${m.label} is done 🔔`);
          log(c, 'done', m.owner_id, m.id);
          return true;
        }
        break;
      case 'RESERVED':
        if (m.owner_id == null) {
          freeMachine(c, m);
          return true;
        }
        if (c.now >= m.reserved_until!) {
          miss(c, m);
          return true;
        }
        break;
      case 'FINISHED':
        if (!m.owner_pinged_at && c.now >= m.finished_at! + 10 * MIN && waitingCount(c, m.type) > 0) {
          setMachine(c, m.id, { owner_pinged_at: c.now }, false);
          return true;
        }
        if (m.owner_pinged_at && confirmed(c, m.id, 'out')) {
          movedOut(c, m);
          return true;
        }
        break;
      case 'OCCUPIED_UNKNOWN':
        if (confirmed(c, m.id, 'clear')) {
          freeMachine(c, m);
          sys(c, `${m.label} is empty and free again.`);
          log(c, 'cleared', null, m.id);
          return true;
        }
        break;
      case 'FREE':
        if (!quiet) {
          const q = queueHead(c, m);
          if (q) {
            reserve(c, m, q);
            return true;
          }
        }
        break;
    }
  }
  return false;
}

/**
 * First in line, except someone in their 5-minute cooldown after a miss is
 * skipped while anyone else is waiting.
 */
function queueHead(c: Ctx, m: MachineRow): QueueRow | undefined {
  return c.db
    .prepare(
      `SELECT * FROM queue WHERE type = ? AND status = 'waiting'
       ORDER BY (eligible_at > ?) ASC, position_at ASC, id ASC LIMIT 1`,
    )
    .get(m.type, c.now) as QueueRow | undefined;
}

function reserve(c: Ctx, m: MachineRow, q: QueueRow) {
  setMachine(c, m.id, {
    state: 'RESERVED',
    owner_id: q.user_id,
    reserved_until: c.now + c.s.windowMin * MIN,
    est_min: q.est_min,
    snooze_used: 0,
    started_at: null,
    ends_at: null,
    finished_at: null,
    ext_used: 0,
    overrun_noticed: 0,
    owner_pinged_at: null,
    note: null,
  });
  c.db.prepare("UPDATE queue SET status = 'reserved' WHERE id = ?").run(q.id);
  sys(c, `${userName(c, q.user_id)} is up! ${m.label} is held for ${c.s.windowMin} minutes.`);
  log(c, 'reserve', q.user_id, m.id);
}

function miss(c: Ctx, m: MachineRow) {
  const uid = m.owner_id!;
  const name = userName(c, uid);
  const q = queueRow(c, uid, m.type);
  if (q && q.missed_count + 1 >= 2) {
    c.db.prepare('DELETE FROM queue WHERE id = ?').run(q.id);
    c.db
      .prepare('INSERT INTO blocks(user_id, type, until) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET until = excluded.until')
      .run(uid, m.type, c.now + 30 * MIN);
    sys(c, `${name} missed two turns in a row and left the ${m.type} line for 30 minutes.`);
  } else if (q) {
    c.db
      .prepare(
        "UPDATE queue SET status = 'waiting', position_at = ?, missed_count = missed_count + 1, eligible_at = ?, compensation = 0 WHERE id = ?",
      )
      .run(c.now, c.now + 5 * MIN, q.id);
    sys(c, `${name} missed their turn and went to the back of the line.`);
  }
  log(c, 'miss', uid, m.id, { missed: (q?.missed_count ?? 0) + 1 });
  freeMachine(c, m);
}

function movedOut(c: Ctx, m: MachineRow) {
  const by = validConfirmations(c, m.id, 'out').map((r) => userName(c, r.user_id));
  log(c, 'moved', null, m.id, { owner: m.owner_id, by });
  sys(c, `${userName(c, m.owner_id)}'s clothes in ${m.label} were moved out by ${by.join(' and ')}.`);
  freeMachine(c, m);
}
