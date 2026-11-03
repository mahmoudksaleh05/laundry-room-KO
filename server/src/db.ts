import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { Settings } from '@suds/shared';

export type DB = Database.Database;

const SCHEMA = `
CREATE TABLE users(
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  name_lower TEXT NOT NULL UNIQUE,
  emoji TEXT NOT NULL,
  recovery_hash TEXT NOT NULL,
  recovery_salt TEXT NOT NULL,
  muted_until INTEGER,
  created_at INTEGER NOT NULL,
  last_active INTEGER NOT NULL
);
CREATE TABLE devices(
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  push_sub TEXT,
  admin_until INTEGER,
  last_seen INTEGER NOT NULL
);
CREATE TABLE machines(
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('washer','dryer')),
  label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'FREE'
    CHECK(state IN ('FREE','RESERVED','RUNNING','FINISHED','OCCUPIED_UNKNOWN','OUT_OF_ORDER')),
  owner_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reserved_until INTEGER,
  snooze_used INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER,
  ends_at INTEGER,
  finished_at INTEGER,
  est_min INTEGER,
  ext_used INTEGER NOT NULL DEFAULT 0,
  overrun_noticed INTEGER NOT NULL DEFAULT 0,
  owner_pinged_at INTEGER,
  note TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  retired_at INTEGER
);
CREATE TABLE queue(
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  est_min INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  position_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting' CHECK(status IN ('waiting','reserved')),
  missed_count INTEGER NOT NULL DEFAULT 0,
  eligible_at INTEGER NOT NULL DEFAULT 0,
  compensation INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, type)
);
CREATE INDEX queue_head ON queue(type, status, position_at);
CREATE TABLE blocks(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY(user_id, type)
);
CREATE TABLE confirmations(
  machine_id TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('out','clear')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(machine_id, user_id, kind)
);
CREATE TABLE messages(
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('normal','announcement','system')),
  text TEXT NOT NULL CHECK(length(text) <= 400),
  pinned_until INTEGER,
  deleted INTEGER NOT NULL DEFAULT 0,
  reports INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE events(
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  user_id INTEGER,
  machine_id TEXT,
  action TEXT NOT NULL,
  detail TEXT
);
CREATE INDEX events_at ON events(at);
CREATE INDEX events_user_action ON events(user_id, action, at);
CREATE TABLE actions(
  user_id INTEGER NOT NULL,
  client_action_id TEXT NOT NULL,
  result TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY(user_id, client_action_id)
);
CREATE TABLE push_log(key TEXT PRIMARY KEY, at INTEGER NOT NULL);
CREATE TABLE config(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

interface SeedFile extends Omit<Settings, 'tz' | 'linksAllowed'> {
  machines: { type: 'washer' | 'dryer'; label: string }[];
}

const seedPath = new URL('../../config/machines.json', import.meta.url);

export function openDb(file: string, tz = 'UTC'): DB {
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  if (db.pragma('user_version', { simple: true }) === 0) {
    db.transaction(() => {
      db.exec(SCHEMA);
      seed(db, tz);
      db.pragma('user_version = 1');
    })();
  }
  return db;
}

function seed(db: DB, tz: string) {
  const s = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;
  const ins = db.prepare('INSERT INTO machines(id, type, label, sort) VALUES (?, ?, ?, ?)');
  const n = { washer: 0, dryer: 0 };
  s.machines.forEach((m, i) => ins.run(`${m.type[0]}${++n[m.type]}`, m.type, m.label, i));
  const settings: Settings = {
    windowMin: s.windowMin,
    snoozeMin: s.snoozeMin,
    capMin: s.capMin,
    quietStart: s.quietStart,
    quietEnd: s.quietEnd,
    presets: s.presets,
    tz,
    linksAllowed: false,
  };
  setConfig(db, 'settings', JSON.stringify(settings));
}

export function getConfig(db: DB, key: string): string | undefined {
  return (db.prepare('SELECT value FROM config WHERE key = ?').get(key) as { value: string } | undefined)?.value;
}

export function setConfig(db: DB, key: string, value: string) {
  db.prepare(
    'INSERT INTO config(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}
