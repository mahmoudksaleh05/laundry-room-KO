import { beforeEach, describe, expect, it } from 'vitest';
import type { Ack, MachineView, Snapshot } from '@suds/shared';
import { openDb, type DB } from '../src/db';
import { MIN, makeCtx, type Actor } from '../src/core/ctx';
import { execCommand, transact } from '../src/core/engine';
import { authenticate, hashToken, login, register } from '../src/core/identity';
import { duePushes } from '../src/core/pushes';
import { isQuiet } from '../src/core/quiet';
import { buildSnapshot, chatList } from '../src/core/snapshot';

// 2026-10-14 12:00 UTC = 14:00 in Berlin
const T0 = Date.UTC(2026, 9, 14, 12, 0);
let db: DB;
let now: number;
const at = (min: number) => (now = T0 + min * MIN);

let rooms = 0;
/** Each test user gets their own room unless one is given. */
function user(name: string, room = String(101 + rooms++)): Actor {
  const { result } = transact(db, now, (c) => register(c, { name, room, emoji: '🫧' }));
  return authenticate(db, result.token, now)!;
}
function admin(a: Actor): Actor {
  db.prepare('UPDATE devices SET admin_until = ? WHERE token_hash = ?').run(now + 60 * MIN, a.deviceHash);
  return { ...a, isAdmin: true };
}
const cmd = (a: Actor, name: string, input: unknown = {}): Ack => execCommand(db, now, a, name, input).result;
const tick = () => transact(db, now, () => undefined);
const snap = (): Snapshot => transact(db, now, (c) => buildSnapshot(c, false)).result;
const m = (id: string): MachineView => snap().machines.find((x) => x.id === id)!;
const queue = (type: 'washer' | 'dryer' = 'washer') => snap().queues[type].map((q) => q.name);
const chat = () => transact(db, now, (c) => chatList(c)).result.map((x) => x.text);
const pushes = () => transact(db, now, (c) => duePushes(c)).result;
const kinds = (p: { key: string }[]) => p.map((x) => x.key.split(':')[0]);
/** Keep the test to a single washer unless a test needs more. */
function onlyWasher() {
  db.prepare("UPDATE machines SET retired_at = 1 WHERE id IN ('w2','w3')").run();
}

beforeEach(() => {
  db = openDb(':memory:', 'Europe/Berlin');
  rooms = 0;
  at(0);
});

describe('seed', () => {
  it('starts with 3 washers and 3 dryers, all free', () => {
    const s = snap();
    expect(s.machines.filter((x) => x.type === 'washer')).toHaveLength(3);
    expect(s.machines.filter((x) => x.type === 'dryer')).toHaveLength(3);
    expect(s.machines.every((x) => x.state === 'FREE')).toBe(true);
  });
});

describe('queue & turn window', () => {
  beforeEach(onlyWasher);

  it('reserves a free machine for the head of the line', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'join', { type: 'washer', estMin: 45 })).toEqual({ ok: true });
    expect(m('w1')).toMatchObject({ state: 'RESERVED', owner: { name: 'Ana' }, reservedUntil: now + 10 * MIN });
  });

  it('miss #1: back of the line, machine goes to the next person', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(10);
    tick();
    expect(m('w1')).toMatchObject({ state: 'RESERVED', owner: { name: 'Ben' } });
    expect(queue()).toEqual(['Ben', 'Ana']);
    expect(snap().queues.washer.find((q) => q.name === 'Ana')!.missed).toBe(1);
    expect(chat()).toContain('Ana missed their turn and went to the back of the line.');
  });

  it('lone user who misses is re-reserved (nobody else waiting); a second miss removes and blocks them', () => {
    const ana = user('Ana');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    at(10);
    tick();
    expect(m('w1')).toMatchObject({ state: 'RESERVED', owner: { name: 'Ana' } });
    at(20);
    tick();
    expect(m('w1').state).toBe('FREE');
    expect(queue()).toEqual([]);
    expect(cmd(ana, 'join', { type: 'washer', estMin: 45 })).toMatchObject({ ok: false, code: 'QUEUE_BLOCKED' });
    at(51);
    expect(cmd(ana, 'join', { type: 'washer', estMin: 45 })).toEqual({ ok: true });
  });

  it('cooldown: a newer joiner is reserved before the user who just missed', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    const cat = user('Cat');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(10);
    tick(); // Ana missed → Ben reserved, Ana in cooldown until 15
    at(11);
    cmd(cat, 'join', { type: 'washer', estMin: 30 });
    cmd(ben, 'giveUp', { machineId: 'w1' });
    expect(m('w1').owner?.name).toBe('Cat'); // Ana is ahead in line but cooling down
  });

  it('starting resets the missed counter', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(10);
    tick(); // Ana missed once, Ben reserved
    cmd(ben, 'loaded', { machineId: 'w1' });
    at(40);
    tick();
    cmd(ben, 'collect', { machineId: 'w1' });
    expect(m('w1').owner?.name).toBe('Ana');
    cmd(ana, 'loaded', { machineId: 'w1' });
    expect(queue()).toEqual([]);
    at(90);
    tick();
    cmd(ana, 'collect', { machineId: 'w1' });
    db.prepare("UPDATE machines SET state = 'OUT_OF_ORDER' WHERE id = 'w1'").run();
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    expect(snap().queues.washer[0].missed).toBe(0);
  });

  it('snooze adds 5 minutes once', () => {
    const ana = user('Ana');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    expect(cmd(ana, 'snooze', { machineId: 'w1' })).toEqual({ ok: true });
    expect(m('w1').reservedUntil).toBe(now + 15 * MIN);
    expect(cmd(ana, 'snooze', { machineId: 'w1' })).toMatchObject({ code: 'INVALID_STATE' });
  });

  it('only the owner can load a reserved machine', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    expect(cmd(ben, 'loaded', { machineId: 'w1' })).toMatchObject({ code: 'NOT_YOUR_TURN' });
  });

  it('one spot per type, but washer and dryer lines at once', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'join', { type: 'washer', estMin: 45 }).ok).toBe(true);
    expect(cmd(ana, 'join', { type: 'washer', estMin: 45 })).toMatchObject({ code: 'ALREADY_IN_QUEUE' });
    expect(cmd(ana, 'join', { type: 'dryer', estMin: 60 }).ok).toBe(true);
  });

  it('join is rate limited to 5 per hour', () => {
    const ana = user('Ana');
    for (let i = 0; i < 5; i++) {
      expect(cmd(ana, 'join', { type: 'dryer', estMin: 60 }).ok).toBe(true);
      cmd(ana, 'leave', { type: 'dryer' });
    }
    expect(cmd(ana, 'join', { type: 'dryer', estMin: 60 })).toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('a server restart mid-window gives the same result', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'join', { type: 'washer', estMin: 45 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    // "Restart": nothing ran for 12 minutes, then boot calls advance() once.
    at(12);
    tick();
    expect(m('w1')).toMatchObject({ state: 'RESERVED', owner: { name: 'Ben' }, reservedUntil: now + 10 * MIN });
  });
});

describe('start now & walk-ups', () => {
  it('two simultaneous "Start now": first wins, second is told', () => {
    onlyWasher();
    const ana = user('Ana');
    const ben = user('Ben');
    expect(cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 })).toEqual({ ok: true });
    expect(cmd(ben, 'startNow', { machineId: 'w1', estMin: 30 })).toMatchObject({ code: 'ALREADY_CLAIMED' });
  });

  it('walk-ups cannot cut in when people are waiting', () => {
    onlyWasher();
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(30);
    tick();
    cmd(ana, 'collect', { machineId: 'w1' });
    const cat = user('Cat');
    expect(cmd(cat, 'startNow', { machineId: 'w1', estMin: 30 })).toMatchObject({ code: 'ALREADY_CLAIMED' });
    expect(m('w1').owner?.name).toBe('Ben');
  });

  it('"The machine isn\'t empty": occupied, user to the front, no penalty', () => {
    db.prepare("UPDATE machines SET retired_at = 1 WHERE id = 'w3'").run();
    const ana = user('Ana');
    const ben = user('Ben');
    const cat = user('Cat');
    cmd(ana, 'startNow', { machineId: 'w2', estMin: 60 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    expect(m('w1').owner?.name).toBe('Ben');
    cmd(cat, 'join', { type: 'washer', estMin: 30 });
    expect(cmd(ben, 'notEmpty', { machineId: 'w1' })).toEqual({ ok: true });
    expect(m('w1').state).toBe('OCCUPIED_UNKNOWN');
    expect(queue()).toEqual(['Ben', 'Cat']);
    expect(snap().queues.washer[0]).toMatchObject({ missed: 0, compensation: true });
  });

  it('an occupied machine needs two different users to clear it', () => {
    onlyWasher();
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'markOccupied', { machineId: 'w1' });
    expect(cmd(ana, 'confirmClear', { machineId: 'w1' }).ok).toBe(true);
    expect(cmd(ana, 'confirmClear', { machineId: 'w1' })).toMatchObject({ code: 'DUPLICATE_CONFIRMATION' });
    expect(m('w1').state).toBe('OCCUPIED_UNKNOWN');
    cmd(ben, 'confirmClear', { machineId: 'w1' });
    expect(m('w1').state).toBe('FREE');
  });

  it('confirmations expire after 10 minutes', () => {
    onlyWasher();
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'markOccupied', { machineId: 'w1' });
    cmd(ana, 'confirmClear', { machineId: 'w1' });
    at(11);
    cmd(ben, 'confirmClear', { machineId: 'w1' });
    expect(m('w1').state).toBe('OCCUPIED_UNKNOWN');
  });
});

describe('running & finishing', () => {
  beforeEach(onlyWasher);

  it('a finished cycle becomes FINISHED, not FREE, and the owner is told', () => {
    const ana = user('Ana');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    at(30);
    tick();
    expect(m('w1').state).toBe('FINISHED');
    expect(kinds(pushes())).toContain('done');
  });

  it('cycles are at most 90 minutes and can be extended twice by 15', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'startNow', { machineId: 'w1', estMin: 91 })).toMatchObject({ code: 'INVALID_INPUT' });
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 90 });
    expect(cmd(ana, 'extend', { machineId: 'w1', minutes: 10 })).toMatchObject({ code: 'INVALID_INPUT' });
    expect(cmd(ana, 'extend', { machineId: 'w1', minutes: 15 }).ok).toBe(true);
    expect(cmd(ana, 'extend', { machineId: 'w1', minutes: 15 }).ok).toBe(true);
    expect(cmd(ana, 'extend', { machineId: 'w1', minutes: 15 })).toMatchObject({ code: 'CAP_REACHED' });
    expect(m('w1')).toMatchObject({ extUsed: 30, endsAt: now + 120 * MIN });
  });

  it('takes a custom cycle length', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'join', { type: 'washer', estMin: 42 }).ok).toBe(true);
    cmd(ana, 'loaded', { machineId: 'w1' });
    expect(m('w1').endsAt).toBe(now + 42 * MIN);
  });

  it('posts one notice when extensions go 15+ minutes over the estimate', () => {
    const ana = user('Ana');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    cmd(ana, 'extend', { machineId: 'w1', minutes: 15 });
    expect(chat().filter((t) => t.includes('extended'))).toHaveLength(0);
    cmd(ana, 'extend', { machineId: 'w1', minutes: 15 });
    expect(chat().filter((t) => t.includes('extended'))).toHaveLength(1);
  });

  it('forgotten laundry: owner pinged first, then two users may move it', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    const cat = user('Cat');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(40);
    tick(); // finished at 30, owner pinged at 40
    expect(cmd(ben, 'confirmOut', { machineId: 'w1' })).toMatchObject({ code: 'TOO_EARLY' });
    at(45);
    expect(cmd(ben, 'confirmOut', { machineId: 'w1' }).ok).toBe(true);
    expect(m('w1').state).toBe('FINISHED');
    cmd(cat, 'confirmOut', { machineId: 'w1' });
    expect(m('w1')).toMatchObject({ state: 'RESERVED', owner: { name: 'Ben' } });
    expect(pushes().some((p) => p.key.startsWith('moved:') && p.userId === ana.userId)).toBe(true);
  });

  it('two users on the same device count as one confirmation', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    const cat = user('Cat');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(40);
    tick();
    at(45);
    cmd(ben, 'confirmOut', { machineId: 'w1' });
    expect(cmd({ ...cat, deviceHash: ben.deviceHash }, 'confirmOut', { machineId: 'w1' })).toMatchObject({
      code: 'DUPLICATE_CONFIRMATION',
    });
  });

  it('a machine breaking mid-cycle sends the owner to the front with compensation', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    cmd(ben, 'reportBroken', { machineId: 'w1', note: 'leaking' });
    expect(m('w1')).toMatchObject({ state: 'OUT_OF_ORDER', note: 'leaking' });
    expect(queue()).toEqual(['Ana', 'Ben']);
    expect(snap().queues.washer[0].compensation).toBe(true);
    cmd(ben, 'markFixed', { machineId: 'w1' });
    expect(m('w1').owner?.name).toBe('Ana');
  });
});

describe('quiet hours & daylight saving', () => {
  const berlin = { quietStart: '00:00', quietEnd: '07:00', tz: 'Europe/Berlin' };

  it('wraps around midnight', () => {
    const s = { quietStart: '23:00', quietEnd: '06:00', tz: 'UTC' };
    expect(isQuiet(Date.UTC(2026, 0, 1, 23, 30), s)).toBe(true);
    expect(isQuiet(Date.UTC(2026, 0, 1, 5, 59), s)).toBe(true);
    expect(isQuiet(Date.UTC(2026, 0, 1, 6, 0), s)).toBe(false);
  });

  it('follows local time across the October DST change in Berlin', () => {
    // Sat 24 Oct 2026 is CEST (UTC+2); clocks go back on Sun 25 Oct to CET (UTC+1).
    expect(isQuiet(Date.UTC(2026, 9, 23, 22, 30), berlin)).toBe(true); // 00:30 local
    expect(isQuiet(Date.UTC(2026, 9, 24, 4, 59), berlin)).toBe(true); // 06:59 local
    expect(isQuiet(Date.UTC(2026, 9, 24, 5, 0), berlin)).toBe(false); // 07:00 local
    expect(isQuiet(Date.UTC(2026, 9, 25, 5, 30), berlin)).toBe(true); // 06:30 local (CET)
    expect(isQuiet(Date.UTC(2026, 9, 25, 6, 0), berlin)).toBe(false); // 07:00 local (CET)
    expect(isQuiet(Date.UTC(2026, 9, 25, 22, 59), berlin)).toBe(false); // 23:59 local
    expect(isQuiet(Date.UTC(2026, 9, 25, 23, 0), berlin)).toBe(true); // 00:00 local
  });

  it('is open 24/7 by default: a midnight turn is handed out with a push', () => {
    onlyWasher();
    now = Date.UTC(2026, 9, 13, 22, 30); // 00:30 Berlin
    const ana = user('Ana');
    expect(snap().quiet).toBe(false);
    cmd(ana, 'join', { type: 'washer', estMin: 30 });
    expect(m('w1')).toMatchObject({ state: 'RESERVED', owner: { name: 'Ana' } });
    expect(kinds(pushes())).toEqual(['turn']);
  });
});

describe('pushes', () => {
  beforeEach(onlyWasher);

  it('are sent once, not every tick', () => {
    const ana = user('Ana');
    cmd(ana, 'join', { type: 'washer', estMin: 30 });
    at(8.5);
    expect(kinds(pushes()).sort()).toEqual(['turn', 'turn2']);
    expect(pushes()).toEqual([]);
  });

  it('"you\'re next" is not sent once you already have the machine', () => {
    const ana = user('Ana');
    const ben = user('Ben');
    cmd(ana, 'startNow', { machineId: 'w1', estMin: 30 });
    cmd(ben, 'join', { type: 'washer', estMin: 30 });
    at(30);
    tick();
    cmd(ana, 'collect', { machineId: 'w1' });
    expect(kinds(pushes().filter((p) => p.userId === ben.userId))).toEqual(['turn']);
  });
});

describe('board', () => {
  it('rate limits, filters links, masks profanity, stores plain text', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'sendMessage', { text: '<img src=x onerror=alert(1)>' }).ok).toBe(true);
    expect(cmd(ana, 'sendMessage', { text: 'again' })).toMatchObject({ code: 'RATE_LIMITED' });
    at(1);
    expect(cmd(ana, 'sendMessage', { text: 'see www.example.com' })).toMatchObject({ code: 'LINKS_BLOCKED' });
    expect(cmd(ana, 'sendMessage', { text: 'oh shit' }).ok).toBe(true);
    expect(chat()).toEqual(['<img src=x onerror=alert(1)>', 'oh s***']);
  });

  it('only admins announce; max 3 pinned', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'sendMessage', { text: 'hi', announce: true })).toMatchObject({ code: 'NOT_ADMIN' });
    const boss = admin(ana);
    for (let i = 0; i < 4; i++) {
      at(i);
      cmd(boss, 'sendMessage', { text: `notice ${i}`, announce: true });
    }
    const pinned = transact(db, now, (c) => chatList(c)).result.filter((x) => x.pinnedUntil);
    expect(pinned.map((p) => p.text)).toEqual(['notice 1', 'notice 2', 'notice 3']);
  });
});

describe('identity', () => {
  it('logs in with name + room; names are unique per room, case-insensitively', () => {
    const ana = user('Ana', '214');
    expect(() => transact(db, now, (c) => register(c, { name: 'ANA', room: '214', emoji: '🐸' }))).toThrow('NAME_TAKEN');
    user('Ana', '215'); // same name, other room is fine
    const { result } = transact(db, now, (c) => login(c, { name: 'ana', room: '214' }));
    expect(authenticate(db, result.token, now)!.userId).toBe(ana.userId);
    expect(() => transact(db, now, (c) => login(c, { name: 'Ana', room: '216' }))).toThrow('NO_ACCOUNT');
  });

  it('allows at most 2 people per room and only floors 1–8', () => {
    user('Ana', '305');
    user('Ben', '305');
    expect(() => transact(db, now, (c) => register(c, { name: 'Cat', room: '305', emoji: '🐸' }))).toThrow('ROOM_FULL');
    expect(() => transact(db, now, (c) => register(c, { name: 'Dan', room: '905', emoji: '🐸' }))).toThrow();
  });

  it('stores only token hashes', () => {
    const { result } = transact(db, now, (c) => register(c, { name: 'Ana', room: '101', emoji: '🐸' }));
    const row = db.prepare('SELECT token_hash FROM devices').get() as { token_hash: string };
    expect(row.token_hash).toBe(hashToken(result.token));
  });
});

describe('admin machines', () => {
  it('adds, retires (only when free) and restores machines', () => {
    const boss = admin(user('Boss'));
    expect(cmd(boss, 'addMachine', { type: 'washer', label: 'Washer 4' })).toEqual({ ok: true, data: { id: 'w4' } });
    expect(snap().machines.filter((x) => x.type === 'washer')).toHaveLength(4);
    const ana = user('Ana');
    cmd(ana, 'startNow', { machineId: 'w4', estMin: 30 });
    expect(cmd(boss, 'retireMachine', { machineId: 'w4' })).toMatchObject({ code: 'INVALID_STATE' });
    cmd(boss, 'forceFree', { machineId: 'w4' });
    expect(cmd(boss, 'retireMachine', { machineId: 'w4' }).ok).toBe(true);
    expect(snap().machines.find((x) => x.id === 'w4')).toBeUndefined();
    cmd(boss, 'restoreMachine', { machineId: 'w4' });
    expect(m('w4').state).toBe('FREE');
  });

  it('non-admins cannot run admin commands', () => {
    const ana = user('Ana');
    expect(cmd(ana, 'addMachine', { type: 'dryer', label: 'Dryer 9' })).toMatchObject({ code: 'NOT_ADMIN' });
  });

  it('reorders machines', () => {
    const boss = admin(user('Boss'));
    cmd(boss, 'moveMachine', { machineId: 'w3', dir: -1 });
    expect(snap().machines.filter((x) => x.type === 'washer').map((x) => x.id)).toEqual(['w1', 'w3', 'w2']);
  });
});

it('settings come from the config table', () => {
  expect(makeCtx(db, now).s).toMatchObject({ windowMin: 10, tz: 'Europe/Berlin', quietStart: '00:00' });
});
