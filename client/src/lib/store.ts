import type { Ack, ChatMessage, CommandName, Me, Snapshot } from '@suds/shared';
import { errorText } from '@suds/shared';
import { useSyncExternalStore } from 'react';
import { createClient, type RealtimeChannel } from '@supabase/supabase-js';
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
// Commands go over HTTP. Board changes arrive via Supabase Realtime when configured,
// otherwise (local dev) by polling.

interface Full {
  me: Me;
  snapshot: Snapshot;
  chat: ChatMessage[];
  vapidPublicKey: string | null;
  serverNow: number;
}

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPA_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
let channel: RealtimeChannel | null = null;
let pollTimer: number | undefined;
let deadlineTimer: number | undefined;
let bestRtt = Infinity;

/** JSON call to the API. Returns the server's Ack, or OFFLINE. */
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
    const ack = (await r.json()) as Ack<T>;
    if (!ack.ok && ack.code === 'AUTH' && state.token) signOut();
    return ack;
  } catch {
    return { ok: false, code: 'OFFLINE' };
  }
}

function applyFull(f: Full, rtt: number) {
  const patch: Partial<State> = { status: 'live', me: f.me, chat: f.chat, vapidKey: f.vapidPublicKey };
  applySnap(f.snapshot);
  // The fastest round trip gives the best clock estimate; re-measure when it was poor.
  if (rtt <= bestRtt * 1.5 || rtt < 400) {
    bestRtt = Math.min(bestRtt, rtt);
    patch.offset = f.serverNow + rtt / 2 - Date.now();
  }
  set(patch);
}

function applySnap(snap: Snapshot) {
  set({ snap });
  scheduleDeadlineTick(snap);
}

/** When a timer on screen hits zero, nudge the server so nobody waits for the next cron minute. */
function scheduleDeadlineTick(snap: Snapshot) {
  clearTimeout(deadlineTimer);
  const now = serverNow();
  const times = [
    ...snap.machines.flatMap((m) => [m.reservedUntil, m.endsAt, m.confirmUnlockAt]),
    ...Object.values(snap.queues).flat().map((q) => q.eligibleAt),
  ].filter((t): t is number => t != null && t > now);
  if (!times.length) return;
  const wait = Math.min(...times) - now + 500 + Math.random() * 2500; // jitter: not every phone at once
  if (wait > 2 ** 31 - 1) return;
  deadlineTimer = window.setTimeout(() => void fetch('/api/tick', { method: 'POST' }).catch(() => {}), wait);
}

async function refresh() {
  if (!state.token) return;
  const t0 = Date.now();
  const ack = await api<Full>('GET', '/api/state');
  if (ack.ok && ack.data) applyFull(ack.data, Date.now() - t0);
  else if (!ack.ok && ack.code !== 'AUTH') set({ status: 'offline' });
}

function listen() {
  stopListening();
  if (SUPA_URL && SUPA_KEY) {
    const supa = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });
    channel = supa
      .channel('board')
      .on('postgres_changes', { event: '*', schema: 'laundry', table: 'state', filter: 'id=eq.1' }, (p) => {
        const row = p.new as { snapshot?: Snapshot; chat?: ChatMessage[] };
        if (row.snapshot) applySnap(row.snapshot);
        if (row.chat) set({ chat: row.chat });
      })
      .subscribe((s) => {
        if (s === 'SUBSCRIBED') void refresh(); // catch anything missed while connecting
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') set({ status: 'offline' });
      });
    pollTimer = window.setInterval(() => void refresh(), 5 * 60_000); // me/admin flag, clock drift
  } else {
    pollTimer = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), 3000);
  }
}

function stopListening() {
  void channel?.unsubscribe();
  channel = null;
  clearInterval(pollTimer);
  clearTimeout(deadlineTimer);
}

function connect(token: string) {
  set({ token, status: 'connecting' });
  bestRtt = Infinity;
  void refresh();
  listen();
}

export async function boot() {
  const token = await loadToken();
  if (!token) return set({ status: 'signed-out' });
  connect(token);
  const wake = () => document.visibilityState === 'visible' && void refresh();
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('focus', wake);
  window.addEventListener('online', wake);
}

export function signIn(token: string) {
  saveToken(token);
  connect(token);
}

export function signOut() {
  stopListening();
  saveToken(null);
  set({ status: 'signed-out', token: null, me: null, snap: null, chat: [] });
}

/** Send a command. Same clientActionId on retry, so a double send is harmless. */
export async function command<T = unknown>(type: CommandName, input: object = {}, opts: { quiet?: boolean } = {}): Promise<Ack<T>> {
  const msg = { clientActionId: crypto.randomUUID(), type, input };
  let ack: Ack<T> = { ok: false, code: 'OFFLINE' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const t0 = Date.now();
    const res = await api<{ ack: Ack<T>; state: Full }>('POST', '/api/cmd', msg);
    if (res.ok) {
      ack = res.data!.ack;
      applyFull(res.data!.state, Date.now() - t0);
      break;
    }
    ack = res;
    if (res.code !== 'OFFLINE') break; // only network failures are worth a retry
  }
  if (!ack.ok && !opts.quiet) toast(errorText(ack.code));
  return ack;
}
