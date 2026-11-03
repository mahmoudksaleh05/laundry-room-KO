import webpush from 'web-push';
import { getConfig, setConfig, type DB } from '../db';
import type { PushIntent } from '../core/pushes';

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** VAPID keys from env, or generated once and kept in the database. */
export function setupVapid(db: DB, pub: string | undefined, priv: string | undefined, subject: string) {
  let keys = pub && priv ? { publicKey: pub, privateKey: priv } : undefined;
  if (!keys) {
    const stored = getConfig(db, 'vapid');
    keys = stored ? JSON.parse(stored) : webpush.generateVAPIDKeys();
    if (!stored) setConfig(db, 'vapid', JSON.stringify(keys));
  }
  webpush.setVapidDetails(subject, keys!.publicKey, keys!.privateKey);
  return keys!.publicKey;
}

export function validSub(x: unknown): x is PushSub {
  const s = x as PushSub;
  return (
    !!s &&
    typeof s.endpoint === 'string' &&
    s.endpoint.startsWith('https://') &&
    s.endpoint.length < 1000 &&
    typeof s.keys?.p256dh === 'string' &&
    typeof s.keys?.auth === 'string' &&
    s.keys.p256dh.length < 200 &&
    s.keys.auth.length < 100
  );
}

const recent = new Map<number, number[]>();

/** Max 6 pushes per user per minute, on top of the per-situation dedupe. */
function allow(userId: number, now: number) {
  const list = (recent.get(userId) ?? []).filter((t) => now - t < 60_000);
  if (list.length >= 6) return false;
  list.push(now);
  recent.set(userId, list);
  return true;
}

/** Every push shows a visible notification (iOS revokes subscriptions that receive silent pushes). */
export async function sendPushes(db: DB, intents: PushIntent[], now = Date.now()) {
  for (const p of intents) {
    if (!allow(p.userId, now)) continue;
    const devices = db
      .prepare('SELECT token_hash, push_sub FROM devices WHERE user_id = ? AND push_sub IS NOT NULL')
      .all(p.userId) as { token_hash: string; push_sub: string }[];
    const payload = JSON.stringify({ title: p.title, body: p.body, tag: p.key.split(':')[0], url: '/' });
    await Promise.all(
      devices.map(async (d) => {
        try {
          await webpush.sendNotification(JSON.parse(d.push_sub), payload, { TTL: 900, urgency: 'high' });
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            db.prepare('UPDATE devices SET push_sub = NULL WHERE token_hash = ?').run(d.token_hash);
          } else {
            console.warn('push failed', code ?? (e as Error).message);
          }
        }
      }),
    );
  }
}
