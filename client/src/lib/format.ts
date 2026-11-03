import type { MachineView, Snapshot } from '@suds/shared';

export const mmss = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const mins = (ms: number) => Math.max(0, Math.ceil(ms / 60_000));

/** Clock time in the dorm's time zone. */
export const hm = (t: number, tz?: string) =>
  new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(t);

export const ago = (ms: number) => {
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
};

export const typeLabel = { washer: 'Washers', dryer: 'Dryers' } as const;
export const typeOne = { washer: 'washer', dryer: 'dryer' } as const;

export const STATE = {
  FREE: { icon: '✓', label: 'Free' },
  RESERVED: { icon: '⏳', label: 'Reserved' },
  RUNNING: { icon: '⟳', label: 'Running' },
  FINISHED: { icon: '🔔', label: 'Done' },
  OCCUPIED_UNKNOWN: { icon: '?', label: 'In use' },
  OUT_OF_ORDER: { icon: '🔧', label: 'Out of order' },
} as const;

/** 0..1 for progress rings, from server timestamps only. */
export function progress(m: MachineView, now: number, windowMin: number): number | null {
  if (m.state === 'RESERVED' && m.reservedUntil) {
    const total = (windowMin + (m.snoozeUsed ? 5 : 0)) * 60_000;
    return Math.min(1, Math.max(0, (m.reservedUntil - now) / total));
  }
  if ((m.state === 'RUNNING' || m.state === 'OCCUPIED_UNKNOWN') && m.startedAt && m.endsAt) {
    return Math.min(1, Math.max(0, (now - m.startedAt) / (m.endsAt - m.startedAt)));
  }
  return null;
}

export function machineLine(m: MachineView, now: number, s: Snapshot): string {
  const tz = s.settings.tz;
  switch (m.state) {
    case 'FREE':
      return s.queues[m.type].some((q) => q.status === 'waiting') ? 'Next person up shortly' : 'Ready now';
    case 'RESERVED':
      return `Held for ${m.owner?.name ?? 'someone'} ${m.owner?.emoji ?? ''} · ${mmss((m.reservedUntil ?? now) - now)}`;
    case 'RUNNING':
      return `${m.owner?.emoji ?? ''} ${m.owner?.name ?? ''} · ${mins((m.endsAt ?? now) - now)} min · ready ${hm(m.endsAt ?? now, tz)}${m.extUsed ? ` · +${m.extUsed}` : ''}`;
    case 'FINISHED':
      return `${m.owner?.name ?? 'Someone'}'s · waiting ${ago(now - (m.finishedAt ?? now))}`;
    case 'OCCUPIED_UNKNOWN':
      return m.endsAt && m.endsAt > now ? `In use without the app · ~${mins(m.endsAt - now)} min` : 'In use without the app';
    case 'OUT_OF_ORDER':
      return m.note ? `“${m.note}”` : 'Reported broken';
  }
}

export const stateLabel = (m: MachineView, now: number) => {
  if (m.state === 'RUNNING' && m.endsAt) return `${STATE.RUNNING.icon} ${mins(m.endsAt - now)} min`;
  if (m.state === 'RESERVED' && m.reservedUntil) return `${STATE.RESERVED.icon} ${mmss(m.reservedUntil - now)}`;
  return `${STATE[m.state].icon} ${STATE[m.state].label}`;
};
