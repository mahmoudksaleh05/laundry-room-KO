import type { MachineType, Snapshot } from './types';

const MIN = 60_000;

/**
 * Rough wait (ms) until `userId` gets a machine of `type`: simulate the line
 * handing out machines in order as each one frees up.
 * Returns null if the user is not waiting or no machine can be used.
 */
export function estimateWait(s: Snapshot, now: number, type: MachineType, userId: number): number | null {
  const free: number[] = [];
  for (const m of s.machines) {
    if (m.type !== type) continue;
    if (m.state === 'OUT_OF_ORDER') continue;
    if (m.state === 'FREE') free.push(now);
    else if (m.state === 'RESERVED') free.push((m.reservedUntil ?? now) + (m.estMin ?? 45) * MIN);
    else if (m.state === 'RUNNING' || m.state === 'OCCUPIED_UNKNOWN') free.push(Math.max(now, m.endsAt ?? now));
    else if (m.state === 'FINISHED') free.push(now + 5 * MIN);
  }
  if (!free.length) return null;
  for (const q of s.queues[type]) {
    if (q.status !== 'waiting') continue;
    free.sort((a, b) => a - b);
    const at = free[0];
    if (q.userId === userId) return Math.max(0, at - now);
    free[0] = at + q.estMin * MIN;
  }
  return null;
}
