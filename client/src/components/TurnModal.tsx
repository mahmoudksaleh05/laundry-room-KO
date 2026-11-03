import type { MachineView, Settings } from '@suds/shared';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useBackClose } from '../lib/back';
import { mmss, progress, typeOne } from '../lib/format';
import { chime, vibrate } from '../lib/sound';
import { command, useNow } from '../lib/store';
import { BubbleBurst } from './ui';

/** Full-screen "it's your turn" moment for a machine reserved for me. */
export function TurnModal({ m, settings, onClose }: { m: MachineView; settings: Settings; onClose: () => void }) {
  const now = useNow();
  const [busy, setBusy] = useState(false);
  const [askNotEmpty, setAskNotEmpty] = useState(false);
  useBackClose(true, onClose);

  useEffect(() => {
    chime();
    vibrate([180, 90, 180]);
    const title = document.title;
    let on = false;
    const t = setInterval(() => {
      on = !on;
      document.title = on ? '🫧 Your turn!' : title;
    }, 1000);
    return () => {
      clearInterval(t);
      document.title = title;
    };
  }, []);

  const left = (m.reservedUntil ?? now) - now;
  const p = progress(m, now, settings.windowMin) ?? 0;
  const r = 96;
  const c = 2 * Math.PI * r;
  const act = async (type: 'loaded' | 'snooze' | 'giveUp' | 'notEmpty') => {
    setBusy(true);
    const ack = await command(type, { machineId: m.id });
    setBusy(false);
    if (ack.ok && type !== 'snooze') onClose();
  };

  return (
    <motion.div className="turn" data-s={left < 120_000 ? 'FINISHED' : 'RESERVED'} role="alertdialog" aria-labelledby="turn-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <BubbleBurst />
      <div className="inner">
        <p className="eyebrow">It's your turn</p>
        <h1 id="turn-title" className="display mt-1 mb-5 text-4xl">
          {m.label} is yours
        </h1>
        <div className="ring-timer" aria-label={`${mmss(left)} left to load`}>
          <svg viewBox="0 0 210 210">
            <circle cx="105" cy="105" r={r} stroke="var(--line)" />
            <circle cx="105" cy="105" r={r} stroke="var(--fg)" strokeDasharray={c} strokeDashoffset={c * (1 - p)} style={{ transition: 'stroke-dashoffset 1s linear' }} />
          </svg>
          <div className="t num">{mmss(left)}</div>
        </div>
        <p className="muted mb-6">
          Load your laundry and start the {typeOne[m.type]}, then tap below. If the timer runs out, the {typeOne[m.type]} goes to the next person.
        </p>
        {askNotEmpty ? (
          <div className="card grid gap-2 p-4 text-left">
            <p className="font-bold">Someone else's clothes are still inside?</p>
            <p className="muted text-sm">We'll mark it as in use and keep your place at the very front of the line.</p>
            <button className="btn btn-primary btn-lg mt-2" disabled={busy} onClick={() => act('notEmpty')}>
              Yes, it's not empty
            </button>
            <button className="btn btn-ghost" onClick={() => setAskNotEmpty(false)}>
              Never mind
            </button>
          </div>
        ) : (
          <div className="grid gap-2">
            <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => act('loaded')}>
              I've started it
            </button>
            <div className="grid grid-cols-2 gap-2">
              <button className="btn btn-secondary" disabled={busy || m.snoozeUsed} onClick={() => act('snooze')}>
                {m.snoozeUsed ? 'Snoozed' : `+${settings.snoozeMin} min`}
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setAskNotEmpty(true)}>
                It's not empty
              </button>
            </div>
            <div className="mt-1 flex justify-between">
              <button className="btn btn-ghost" onClick={onClose}>
                Later
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => act('giveUp')}>
                Give up my turn
              </button>
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}
