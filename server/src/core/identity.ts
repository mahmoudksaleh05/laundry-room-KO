import { createHash, randomBytes, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { getConfig, setConfig, type DB } from '../db';
import { FREE_PATCH, fail, freeMachine, log, setMachine, type Actor, type Ctx, type MachineRow } from './ctx';

export interface Hashed {
  salt: string;
  hash: string;
}

/** For low-entropy secrets (recovery code, dorm code, admin PIN): slow, salted. */
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

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const newRecoveryCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const normCode = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');

export function ensureDormCode(db: DB, envCode: string) {
  if (!getConfig(db, 'dorm_code')) setConfig(db, 'dorm_code', JSON.stringify(hashSecret(envCode.toUpperCase())));
}

function checkDormCode(c: Ctx, code: string) {
  const h = JSON.parse(getConfig(c.db, 'dorm_code')!) as Hashed;
  if (!verifySecret(code.trim().toUpperCase(), h)) fail('BAD_CODE');
}

function newDevice(c: Ctx, userId: number): string {
  const token = randomBytes(16).toString('hex');
  c.db.prepare('INSERT INTO devices(token_hash, user_id, last_seen) VALUES (?, ?, ?)').run(hashToken(token), userId, c.now);
  return token;
}

export function register(c: Ctx, input: { code: string; name: string; emoji: string }) {
  checkDormCode(c, input.code);
  const lower = input.name.toLowerCase();
  if (c.db.prepare('SELECT 1 FROM users WHERE name_lower = ?').get(lower)) fail('NAME_TAKEN');
  const recoveryCode = newRecoveryCode();
  const h = hashSecret(recoveryCode);
  const { lastInsertRowid } = c.db
    .prepare(
      'INSERT INTO users(name, name_lower, emoji, recovery_hash, recovery_salt, created_at, last_active) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(input.name, lower, input.emoji, h.hash, h.salt, c.now, c.now);
  const userId = Number(lastInsertRowid);
  log(c, 'register', userId);
  return { token: newDevice(c, userId), recoveryCode };
}

export function recover(c: Ctx, input: { code: string; name: string; recoveryCode: string }) {
  checkDormCode(c, input.code);
  const u = c.db
    .prepare('SELECT id, recovery_hash, recovery_salt FROM users WHERE name_lower = ?')
    .get(input.name.toLowerCase()) as { id: number; recovery_hash: string; recovery_salt: string } | undefined;
  // Same error either way, so names can't be probed.
  if (!u || !verifySecret(normCode(input.recoveryCode), { salt: u.recovery_salt, hash: u.recovery_hash })) {
    fail('BAD_CODE');
  }
  log(c, 'recover', u!.id);
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
  const held = c.db.prepare('SELECT * FROM machines WHERE owner_id = ?').all(userId) as MachineRow[];
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
