import { api, getState } from './store';
import { mode, pushSupported } from './platform';

export type PushState = 'unsupported' | 'needs-install' | 'default' | 'denied' | 'granted';

export function pushState(): PushState {
  if (mode() === 'ios-tab') return 'needs-install';
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushState;
}

function keyBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function subscribe(): Promise<boolean> {
  const key = getState().vapidKey;
  if (!key) return false;
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  try {
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  } catch {
    // Old subscription with a different server key: replace it.
    await sub?.unsubscribe();
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  }
  const r = await api('POST', '/api/push', { subscription: sub.toJSON() });
  return r.ok;
}

/** Only ever called from a tap. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported() || mode() === 'ios-tab') return pushState();
  const p = await Notification.requestPermission();
  if (p === 'granted') await subscribe().catch(() => false);
  return pushState();
}

/** Every app load: refresh the subscription if permission was already given. */
export async function reRegisterPush() {
  if (pushSupported() && Notification.permission === 'granted') await subscribe().catch(() => false);
}
