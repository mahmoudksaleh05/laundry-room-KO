import type { Settings } from '@suds/shared';

const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** Minutes since local midnight in `tz` for a UTC timestamp. DST-safe: Intl does the conversion. */
export function localMinutes(now: number, tz: string): number {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    fmtCache.set(tz, f);
  }
  const p = f.formatToParts(now);
  return Number(p.find((x) => x.type === 'hour')!.value) * 60 + Number(p.find((x) => x.type === 'minute')!.value);
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

export function isQuiet(now: number, s: Pick<Settings, 'quietStart' | 'quietEnd' | 'tz'>): boolean {
  const start = toMin(s.quietStart);
  const end = toMin(s.quietEnd);
  if (start === end) return false;
  const x = localMinutes(now, s.tz);
  return start < end ? x >= start && x < end : x >= start || x < end;
}

export function validTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
