import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db';
import { FREE_PATCH, fail, freeMachine, log, setMachine, type Actor, type Ctx, type MachineRow } from './ctx';

export interface Hashed {
  salt: string;
  hash: string;
}

/** For low-entropy secrets (the admin PIN): slow, salted. */
export function hashSecret(secret: string, salt = randomBytes(16).toString('hex')): Hashed {
  return { salt, hash: scryptSync(secret, salt, 32).toString('hex') };
}

export function verifySecret(secret: string, h: Hashed): boolean {
  const a = scryptSync(secret, h.salt, 32);
  const b = Buffer.from(h.hash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Device tokens are 128 random bits, so a fast hash is enough. */
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const MAX_PER_ROOM = 2;

function newDevice(c: Ctx, userId: number): string {
  const token = randomBytes(16).toString('hex');
  c.db.prepare('INSERT INTO devices(token_hash, user_id, last_seen) VALUES (?, ?, ?)').run(hashToken(token), userId, c.now);
  return token;
}

/** New resident: name is unique within the room, and a room holds at most 2 people. */
export function register(c: Ctx, input: { name: string; room: string; emoji: string }) {
  const lower = input.name.toLowerCase();
  if (c.db.prepare('SELECT 1 FROM users WHERE room = ? AND name_lower = ?').get(input.room, lower)) fail('NAME_TAKEN');
  const { n } = c.db.prepare('SELECT count(*) AS n FROM users WHERE room = ?').get(input.room) as { n: number };
  if (n >= MAX_PER_ROOM) fail('ROOM_FULL');
  const { lastInsertRowid } = c.db
    .prepare('INSERT INTO users(name, name_lower, room, emoji, created_at, last_active) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.name, lower, input.room, input.emoji, c.now, c.now);
  const userId = Number(lastInsertRowid);
  log(c, 'register', userId, null, { room: input.room });
  return { token: newDevice(c, userId) };
}

/** Log in on any device with the name you chose and your room number. */
export function login(c: Ctx, input: { name: string; room: string }) {
  const u = c.db.prepare('SELECT id FROM users WHERE room = ? AND name_lower = ?').get(input.room, input.name.toLowerCase()) as
    | { id: number }
    | undefined;
  if (!u) fail('NO_ACCOUNT');
  log(c, 'login', u!.id);
  return { token: newDevice(c, u!.id) };
}

export function authenticate(db: DB, token: string, now: number): Actor | null {
  if (typeof token !== 'string' || token.length > 64) return null;
  const h = hashToken(token);
  const d = db.prepare('SELECT user_id, admin_until FROM devices WHERE token_hash = ?').get(h) as
    | { user_id: number; admin_until: number | null }
    | undefined;
  if (!d) return null;
  db.prepare('UPDATE devices SET last_seen = ? WHERE token_hash = ?').run(now, h);
  db.prepare('UPDATE users SET last_active = ? WHERE id = ?').run(now, d.user_id);
  return { userId: d.user_id, deviceHash: h, isAdmin: (d.admin_until ?? 0) > now };
}

/** "Delete my data": machines they hold are released, history is anonymised. */
export function deleteUser(c: Ctx, userId: number) {
  const held = c.db.prepare('SELECT * FROM machines WHERE owner_id = ?').all(userId) as unknown as MachineRow[];
  for (const m of held) {
    if (m.state === 'RUNNING') setMachine(c, m.id, { ...FREE_PATCH, state: 'OCCUPIED_UNKNOWN', started_at: m.started_at, ends_at: m.ends_at, est_min: m.est_min });
    else freeMachine(c, m);
  }
  c.db.prepare('UPDATE events SET user_id = NULL WHERE user_id = ?').run(userId);
  c.db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  log(c, 'delete_user', null);
  c.changed = true;
  c.chatChanged = true;
}
