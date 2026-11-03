import { estimateWait, EXTEND_MIN, MACHINE_TYPES, MAX_EST_MIN, MAX_EXTENDS, type MachineType, type MachineView, type Snapshot } from '@suds/shared';
import { useState } from 'react';
import { MachineArt } from '../components/MachineArt';
import { lcdText, MachineCard } from '../components/MachineCard';
import { Seg, Sheet, StatePill } from '../components/ui';
import { ago, hm, machineLine, mins, mmss, progress, typeLabel, typeOne } from '../lib/format';
import { command, useNow, useStore } from '../lib/store';

export function Laundry({ onTurn }: { onTurn: (id: string) => void }) {
  const snap = useStore((s) => s.snap)!;
  const me = useStore((s) => s.me)!;
  const now = useNow();
  const [openId, setOpenId] = useState<string | null>(null);
  const [joinType, setJoinType] = useState<MachineType | null>(null);
  const open = snap.machines.find((m) => m.id === openId) ?? null;

  return (
    <div>
      <MyStatus s={snap} meId={me.id} now={now} onJoin={setJoinType} onOpen={setOpenId} onTurn={onTurn} />
      {snap.quiet && (
        <div className="banner mt-3" role="note">
          <span aria-hidden>🌙</span>
          <span>Quiet hours until {snap.settings.quietEnd}. The line is paused, so free machines are first come, first served.</span>
        </div>
      )}
      {MACHINE_TYPES.map((type) => {
        const ms = snap.machines.filter((m) => m.type === type);
        const q = snap.queues[type].filter((e) => e.status === 'waiting');
        const free = ms.filter((m) => m.state === 'FREE').length;
        return (
          <section key={type} aria-labelledby={`h-${type}`}>
            <div className="section-head">
              <h2 id={`h-${type}`} className="display">
                {typeLabel[type]}
              </h2>
              <span className="summary">
                {free} free · {q.length} waiting
              </span>
            </div>
            {q.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2" aria-label={`${typeLabel[type]} line`}>
                {q.map((e, i) => (
                  <span key={e.userId} className={`chip${e.userId === me.id ? ' me' : ''}`}>
                    <span className="n">{i + 1}</span>
                    <span aria-hidden>{e.emoji}</span>
                    {e.userId === me.id ? 'You' : e.name}
                    <span className="muted num text-xs">{e.room}</span>
                    {e.compensation && <span className="badge">front</span>}
                  </span>
                ))}
              </div>
            )}
            {ms.length ? (
              <div className="mgrid">
                {ms.map((m) => (
                  <MachineCard key={m.id} m={m} s={snap} now={now} meId={me.id} onOpen={() => setOpenId(m.id)} />
                ))}
              </div>
            ) : (
              <p className="muted text-sm">No {typeLabel[type].toLowerCase()} set up yet.</p>
            )}
          </section>
        );
      })}
      <JoinSheet type={joinType} s={snap} onClose={() => setJoinType(null)} />
      <MachineSheet m={open} s={snap} meId={me.id} isAdmin={me.isAdmin} now={now} onClose={() => setOpenId(null)} onTurn={onTurn} />
    </div>
  );
}

function MyStatus({
  s,
  meId,
  now,
  onJoin,
  onOpen,
  onTurn,
}: {
  s: Snapshot;
  meId: number;
  now: number;
  onJoin: (t: MachineType) => void;
  onOpen: (id: string) => void;
  onTurn: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {MACHINE_TYPES.map((type) => {
        const mine = s.machines.find((m) => m.type === type && m.owner?.id === meId && m.state !== 'OUT_OF_ORDER');
        const qi = s.queues[type].findIndex((e) => e.userId === meId && e.status === 'waiting');
        const block = s.blocks.find((b) => b.userId === meId && b.type === type && b.until > now);
        if (mine)
          return <MineCard key={type} m={mine} now={now} windowMin={s.settings.windowMin} onOpen={() => onOpen(mine.id)} onTurn={() => onTurn(mine.id)} />;
        if (qi >= 0) {
          const e = s.queues[type][qi];
          const wait = estimateWait(s, now, type, meId);
          const ahead = s.queues[type].slice(0, qi).filter((x) => x.status === 'waiting').length;
          return (
            <div key={type} className="card p-4">
              <p className="eyebrow">{typeOne[type]} line</p>
              <p className="display mt-1 text-2xl">{ahead === 0 ? "You're next" : `${ahead} ahead of you`}</p>
              <p className="muted mt-1 text-sm">
                {s.quiet
                  ? `The line resumes at ${s.settings.quietEnd}.`
                  : e.eligibleAt > now
                  ? `Back in line in ${mmss(e.eligibleAt - now)} after a missed turn.`
                  : wait != null
                    ? wait < 60_000
                      ? 'A machine should be yours any moment.'
                      : `About ${mins(wait)} min · around ${hm(now + wait, s.settings.tz)}`
                    : 'Waiting for a machine to come back into service.'}
              </p>
              <button className="btn btn-ghost btn-sm mt-2 -ml-2" onClick={() => command('leave', { type })}>
                Leave the line
              </button>
            </div>
          );
        }
        return (
          <div key={type} className="card flex items-center justify-between gap-3 p-4">
            <div>
              <p className="eyebrow">{typeLabel[type]}</p>
              <p className="mt-1 font-bold">{block ? `Line paused for you · ${mins(block.until - now)} min` : `Need a ${typeOne[type]}?`}</p>
            </div>
            <button className="btn btn-primary" disabled={!!block} onClick={() => onJoin(type)}>
              Join line
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MineCard({ m, now, windowMin, onOpen, onTurn }: { m: MachineView; now: number; windowMin: number; onOpen: () => void; onTurn: () => void }) {
  const text =
    m.state === 'RESERVED'
      ? `Ready for you · ${mmss((m.reservedUntil ?? now) - now)} to load`
      : m.state === 'RUNNING'
        ? `Done in ${mins((m.endsAt ?? now) - now)} min`
        : m.state === 'FINISHED'
          ? `Done ${ago(now - (m.finishedAt ?? now))} ago · please collect`
          : 'In use';
  return (
    <div className="card flex items-center gap-4 p-4" data-s={m.state}>
      <div className="w-16 flex-none">
        <MachineArt type={m.type} state={m.state} progress={progress(m, now, windowMin)} lcd={lcdText(m, now)} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="eyebrow">Your {typeOne[m.type]}</p>
        <p className="display text-2xl">{m.label}</p>
        <p className="muted num text-sm">{text}</p>
      </div>
      <button className="btn btn-primary btn-sm" onClick={m.state === 'RESERVED' ? onTurn : onOpen}>
        {m.state === 'RESERVED' ? 'Start' : m.state === 'FINISHED' ? 'Collect' : 'Open'}
      </button>
    </div>
  );
}

const validEst = (v: number) => Number.isInteger(v) && v >= 5 && v <= MAX_EST_MIN;

/** 30 / 60 / 90 presets, or any length up to the 90-minute max. */
function CycleLength({ presets, value, onChange }: { presets: number[]; value: number; onChange: (v: number) => void }) {
  const [custom, setCustom] = useState(!presets.includes(value));
  return (
    <div className="grid gap-3">
      <Seg
        label="Cycle length"
        options={[...presets, 0]}
        value={custom ? 0 : value}
        onChange={(v) => {
          setCustom(v === 0);
          if (v) onChange(v);
        }}
        fmt={(v) => (v ? `${v} min` : 'Custom')}
      />
      {custom && (
        <label className="flex items-center gap-3 font-bold">
          <input
            className="input num"
            style={{ width: '6rem' }}
            type="number"
            inputMode="numeric"
            min={5}
            max={MAX_EST_MIN}
            autoFocus
            value={value || ''}
            onChange={(e) => onChange(Number(e.target.value))}
            aria-label="Cycle length in minutes"
            aria-invalid={!validEst(value)}
          />
          minutes{' '}
          <span className={`text-sm font-medium ${validEst(value) ? 'muted' : 'text-[var(--fin)]'}`}>(5–{MAX_EST_MIN} max)</span>
        </label>
      )}
    </div>
  );
}

function JoinSheet({ type, s, onClose }: { type: MachineType | null; s: Snapshot; onClose: () => void }) {
  const presets = type ? s.settings.presets[type] : [45];
  const [est, setEst] = useState<number | null>(null);
  const value = est ?? presets[1] ?? presets[0];
  const join = async () => {
    if (!type || !validEst(value)) return;
    const ack = await command('join', { type, estMin: value });
    if (ack.ok) onClose();
  };
  return (
    <Sheet open={!!type} onClose={onClose} title={type ? `Join the ${typeOne[type]} line` : ''}>
      <p className="muted mb-4 text-sm">
        When a {type ? typeOne[type] : 'machine'} frees up it's held for you for {s.settings.windowMin} minutes. We'll alert you.
      </p>
      <p className="mb-2 font-bold">How long is your cycle?</p>
      <CycleLength presets={presets} value={value} onChange={setEst} />
      <button className="btn btn-primary btn-lg mt-6" disabled={!validEst(value)} onClick={join}>
        Join the line
      </button>
    </Sheet>
  );
}

function MachineSheet({
  m,
  s,
  meId,
  isAdmin,
  now,
  onClose,
  onTurn,
}: {
  m: MachineView | null;
  s: Snapshot;
  meId: number;
  isAdmin: boolean;
  now: number;
  onClose: () => void;
  onTurn: (id: string) => void;
}) {
  const [est, setEst] = useState<number | null>(null);
  const [broken, setBroken] = useState<string | null>(null);
  if (!m)
    return (
      <Sheet open={false} onClose={onClose}>
        {null}
      </Sheet>
    );
  const mine = m.owner?.id === meId;
  const presets = s.settings.presets[m.type];
  const value = est ?? presets[1] ?? presets[0];
  const extLeft = MAX_EXTENDS - Math.round(m.extUsed / EXTEND_MIN);
  const waiting = s.queues[m.type].some((e) => e.status === 'waiting');
  const confirmed = m.confirmedBy.includes(meId);
  const run = async (type: Parameters<typeof command>[0], input: object = {}, close = true) => {
    const ack = await command(type, { machineId: m.id, ...input });
    if (ack.ok && close) onClose();
    return ack;
  };

  let actions: React.ReactNode = null;
  switch (m.state) {
    case 'FREE':
      actions =
        waiting && !s.quiet ? (
          <p className="muted text-sm">This one goes to the next person in line in a moment.</p>
        ) : (
          <>
            <p className="font-bold">Start it now</p>
            <CycleLength presets={presets} value={value} onChange={setEst} />
            <button className="btn btn-primary btn-lg" disabled={!validEst(value)} onClick={() => run('startNow', { estMin: value })}>
              I've started {m.label}
            </button>
          </>
        );
      break;
    case 'RESERVED':
      actions = mine ? (
        <button className="btn btn-primary btn-lg" onClick={() => (onClose(), onTurn(m.id))}>
          Open my turn
        </button>
      ) : (
        <p className="muted text-sm">Held for {m.owner?.name}. If they don't show up it goes to the next person.</p>
      );
      break;
    case 'RUNNING':
      actions = mine ? (
        <>
          <button className="btn btn-secondary" disabled={extLeft <= 0} onClick={() => run('extend', { minutes: EXTEND_MIN }, false)}>
            {extLeft > 0 ? `Need more time? +${EXTEND_MIN} min (${extLeft} left)` : 'No extensions left'}
          </button>
          <button className="btn btn-secondary" onClick={() => run('finishEarly')}>
            It finished early
          </button>
          <button className="btn btn-primary btn-lg" onClick={() => run('collect')}>
            I've taken my clothes out
          </button>
        </>
      ) : null;
      break;
    case 'FINISHED':
      actions = mine ? (
        <button className="btn btn-primary btn-lg" onClick={() => run('collect')}>
          I've collected my clothes
        </button>
      ) : m.confirmUnlockAt && now >= m.confirmUnlockAt ? (
        <>
          <p className="muted text-sm">Two neighbours need to confirm before the clothes count as moved out. {m.confirmedBy.length}/2 so far.</p>
          <button className="btn btn-primary btn-lg" disabled={confirmed} onClick={() => run('confirmOut', {}, false)}>
            {confirmed ? 'You confirmed' : "I've moved the clothes out"}
          </button>
        </>
      ) : (
        <p className="muted text-sm">
          {m.owner?.name} has been reminded.
          {m.confirmUnlockAt ? ` If they don't come, you can move the clothes out in ${mmss(m.confirmUnlockAt - now)}.` : ''}
        </p>
      );
      break;
    case 'OCCUPIED_UNKNOWN':
      actions = (
        <>
          <p className="muted text-sm">
            Someone is using it without the app. When it's empty, two people confirm and it goes back to the line. {m.confirmedBy.length}/2 so far.
          </p>
          <button className="btn btn-primary btn-lg" disabled={confirmed && !isAdmin} onClick={() => run('confirmClear', {}, false)}>
            {confirmed && !isAdmin ? 'You confirmed' : "It's empty now"}
          </button>
        </>
      );
      break;
    case 'OUT_OF_ORDER':
      actions = (
        <button className="btn btn-primary btn-lg" onClick={() => run('markFixed')}>
          It works again
        </button>
      );
      break;
  }

  return (
    <Sheet open onClose={onClose}>
      <div className="mb-4 flex items-center gap-4">
        <div className="w-24 flex-none">
          <MachineArt type={m.type} state={m.state} progress={progress(m, now, s.settings.windowMin)} tag={m.owner?.emoji} lcd={lcdText(m, now)} />
        </div>
        <div className="min-w-0">
          <h2 className="display text-3xl">{m.label}</h2>
          <div className="mt-1">
            <StatePill m={m} now={now} />
          </div>
          <p className="muted num mt-2 text-sm">{machineLine(m, now, s)}</p>
        </div>
      </div>
      <div className="grid gap-3">{actions}</div>

      {broken == null ? (
        <div className="mt-5 flex flex-wrap gap-1 border-t border-[var(--line)] pt-3">
          {m.state === 'FREE' && (
            <button className="btn btn-ghost btn-sm" onClick={() => run('markOccupied')}>
              Someone's using it
            </button>
          )}
          {m.state !== 'OUT_OF_ORDER' && (
            <button className="btn btn-ghost btn-sm" onClick={() => setBroken('')}>
              Report a problem
            </button>
          )}
          {isAdmin && m.state !== 'FREE' && (
            <button className="btn btn-danger btn-sm" onClick={() => run('forceFree')}>
              Admin: set free
            </button>
          )}
        </div>
      ) : (
        <div className="mt-5 grid gap-2 border-t border-[var(--line)] pt-4">
          <label className="font-bold" htmlFor="broken-note">
            What's wrong? <span className="muted font-medium">(optional)</span>
          </label>
          <input
            id="broken-note"
            className="input"
            maxLength={120}
            value={broken}
            onChange={(e) => setBroken(e.target.value)}
            placeholder="Door won't lock, leaking…"
          />
          <div className="flex gap-2">
            <button className="btn btn-ghost" onClick={() => setBroken(null)}>
              Cancel
            </button>
            <button className="btn btn-primary flex-1" onClick={() => run('reportBroken', { note: broken }).then(() => setBroken(null))}>
              Mark out of order
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
