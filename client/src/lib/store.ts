import type { Ack, ChatMessage, CommandName, Hello, Me, Snapshot } from '@suds/shared';
import { errorText } from '@suds/shared';
import { useSyncExternalStore } from 'react';
import { io, type Socket } from 'socket.io-client';
import { loadToken, saveToken } from './storage';

export type Status = 'boot' | 'signed-out' | 'connecting' | 'live' | 'offline';

export interface State {
  status: Status;
  token: string | null;
  me: Me | null;
  vapidKey: string | null;
  snap: Snapshot | null;
  chat: ChatMessage[];
  /** serverNow ≈ Date.now() + offset */
  offset: number;
  toasts: { id: number; text: string }[];
}

let state: State = {
  status: 'boot',
  token: null,
  me: null,
  vapidKey: null,
  snap: null,
  chat: [],
  offset: 0,
  toasts: [],
};
const listeners = new Set<() => void>();
const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const getState = () => state;
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

export const serverNow = () => Date.now() + state.offset;

// --- ticking clock for countdowns --------------------------------------------
let tickListeners = new Set<() => void>();
let tickNow = Date.now();
let tickTimer: number | undefined;
function tickSubscribe(l: () => void) {
  tickListeners.add(l);
  if (!tickTimer)
    tickTimer = window.setInterval(() => {
      tickNow = serverNow();
      tickListeners.forEach((f) => f());
    }, 500);
  return () => {
    tickListeners.delete(l);
    if (!tickListeners.size) {
      clearInterval(tickTimer);
      tickTimer = undefined;
    }
  };
}
/** Server-time "now", re-rendering twice a second. Never a local countdown. */
export function useNow(): number {
  return useSyncExternalStore(tickSubscribe, () => tickNow);
}

// --- toasts -------------------------------------------------------------------
let toastId = 0;
export function toast(text: string) {
  const id = ++toastId;
  set({ toasts: [...state.toasts, { id, text }].slice(-3) });
  setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 3800);
}

// --- connection ---------------------------------------------------------------
let socket: Socket | null = null;

async function measureOffset() {
  if (!socket?.connected) return;
  let best: { rtt: number; offset: number } | null = null;
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now();
    try {
      const r = (await socket.timeout(4000).emitWithAck('time')) as { serverNow: number };
      const t1 = Date.now();
      const rtt = t1 - t0;
      const offset = r.serverNow + rtt / 2 - t1;
      if (!best || rtt < best.rtt) best = { rtt, offset };
    } catch {
      /* try again next sync */
    }
  }
  if (best) set({ offset: best.offset });
}

function connect(token: string) {
  socket?.disconnect();
  set({ status: 'connecting' });
  socket = io({ auth: { token }, transports: ['websocket', 'polling'] });
  socket.on('connect', () => {
    set({ status: 'live' });
    void measureOffset();
  });
  socket.on('disconnect', () => set({ status: 'offline' }));
  socket.on('connect_error', (e) => {
    if (e.message === 'AUTH') signOut();
    else set({ status: 'offline' });
  });
  socket.on('hello', (h: Hello) => set({ me: h.me, vapidKey: h.vapidPublicKey, offset: h.serverNow - Date.now() }));
  socket.on('me', (me: Me) => set({ me }));
  socket.on('snapshot', (snap: Snapshot) => set({ snap }));
  socket.on('chat', (chat: ChatMessage[]) => set({ chat }));
  socket.on('clock', () => void measureOffset());
}

/** Wake-ups: reconnect, or re-fetch the full state if still connected. */
function resync() {
  if (!socket) return;
  if (!socket.connected) socket.connect();
  else {
    socket.emit('sync');
    void measureOffset();
  }
}

export async function boot() {
  const token = await loadToken();
  if (!token) return set({ status: 'signed-out' });
  set({ token });
  connect(token);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && resync());
  window.addEventListener('focus', resync);
  window.addEventListener('online', resync);
}

export function signIn(token: string) {
  saveToken(token);
  set({ token });
  connect(token);
}

export function signOut() {
  socket?.disconnect();
  socket = null;
  saveToken(null);
  set({ status: 'signed-out', token: null, me: null, snap: null, chat: [] });
}

/** Send a command. Same clientActionId on retry, so a double send is harmless. */
export async function command<T = unknown>(type: CommandName, input: object = {}, opts: { quiet?: boolean } = {}): Promise<Ack<T>> {
  if (!socket?.connected) {
    if (!opts.quiet) toast(errorText('OFFLINE'));
    return { ok: false, code: 'OFFLINE' };
  }
  const msg = { clientActionId: crypto.randomUUID(), type, input };
  let ack: Ack<T> | undefined;
  for (let attempt = 0; attempt < 2 && !ack; attempt++) {
    try {
      ack = (await socket.timeout(8000).emitWithAck('cmd', msg)) as Ack<T>;
    } catch {
      /* timeout: retry once with the same id */
    }
  }
  ack ??= { ok: false, code: 'OFFLINE' };
  if (!ack.ok && !opts.quiet) toast(errorText(ack.code));
  return ack;
}

/** JSON call to the REST endpoints (sign-up, push, admin login). */
export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<Ack<T>> {
  try {
    const r = await fetch(path, {
      method,
      headers: {
        ...(body ? { 'content-type': 'application/json' } : {}),
        ...(state.token ? { authorization: `Bearer ${state.token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return (await r.json()) as Ack<T>;
  } catch {
    return { ok: false, code: 'OFFLINE' };
  }
}
