import type { MachineView, Snapshot } from '@suds/shared';
import { machineLine, mins, mmss, progress } from '../lib/format';
import { MachineArt } from './MachineArt';
import { StatePill } from './ui';

export const isUrgent = (m: MachineView, now: number) =>
  (m.state === 'RESERVED' && (m.reservedUntil ?? 0) - now < 2 * 60_000) ||
  (m.state === 'FINISHED' && now - (m.finishedAt ?? now) > 10 * 60_000);

export function lcdText(m: MachineView, now: number) {
  if (m.state === 'RUNNING' && m.endsAt) return `${mins(m.endsAt - now)}m`;
  if (m.state === 'RESERVED' && m.reservedUntil) return mmss(m.reservedUntil - now);
  if (m.state === 'FINISHED') return 'END';
  if (m.state === 'OUT_OF_ORDER') return 'ERR';
  return '--';
}

export function MachineCard({ m, s, now, meId, onOpen }: { m: MachineView; s: Snapshot; now: number; meId?: number; onOpen: () => void }) {
  const p = progress(m, now, s.settings.windowMin);
  const urgent = isUrgent(m, now);
  return (
    <button
      className={`mcard card${m.owner?.id === meId ? ' mine' : ''}${urgent ? ' urgent' : ''}`}
      data-s={m.state}
      onClick={onOpen}
      aria-label={`${m.label}: ${machineLine(m, now, s)}`}
    >
      <div className="art">
        <MachineArt type={m.type} state={m.state} progress={p} tag={m.owner?.emoji} urgent={urgent} lcd={lcdText(m, now)} />
      </div>
      <div className="body">
        <div className="title">
          <span className="label">{m.label}</span>
          <StatePill m={m} now={now} urgent={urgent} />
        </div>
        <div className="line">{machineLine(m, now, s)}</div>
        {p != null && (
          <div className="bar">
            <i style={{ width: `${p * 100}%` }} />
          </div>
        )}
      </div>
    </button>
  );
}
