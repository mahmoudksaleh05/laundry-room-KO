import { errorText } from '@suds/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useState, useSyncExternalStore } from 'react';
import { Sock } from '../components/ui';
import { canPromptInstall, mode, onInstallChange, promptInstall } from '../lib/platform';
import { enablePush, pushState } from '../lib/push';
import { unlockAudio } from '../lib/sound';
import { api, signIn } from '../lib/store';

const EMOJI = ['🫧', '🧺', '🧦', '👕', '🌊', '🐙', '🦦', '🐳', '🌸', '🍋', '🌙', '⭐', '🍀', '🦊', '🐝', '🎧'];

type Step = 'login' | 'new' | 'alerts';

export function Onboarding() {
  const [step, setStep] = useState<Step>('login');
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const order: Step[] = ['login', 'new', 'alerts'];
  const roomOk = /^[1-8]\d\d$/.test(room);

  const go = (s: Step) => {
    setErr('');
    setStep(s);
  };

  const login = async () => {
    setBusy(true);
    const r = await api<{ token: string }>('POST', '/api/login', { name, room });
    setBusy(false);
    if (r.ok) {
      setToken(r.data!.token);
      return go('alerts');
    }
    if (r.code === 'NO_ACCOUNT') return go('new');
    setErr(errorText(r.code));
  };

  const register = async () => {
    setBusy(true);
    const r = await api<{ token: string }>('POST', '/api/register', { name, room, emoji });
    setBusy(false);
    if (!r.ok) return setErr(errorText(r.code));
    setToken(r.data!.token);
    go('alerts');
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
      <div className="mb-6 flex items-center justify-between">
        <span className="display brand">
          <span aria-hidden>🫧</span> SudsQueue
        </span>
        <div className="dots" aria-hidden>
          {order.map((s) => (
            <i key={s} className={s === step ? 'on' : ''} />
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          className="flex flex-1 flex-col"
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -24 }}
          transition={{ duration: 0.24 }}
        >
          {step === 'login' && (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                void login();
              }}
            >
              <Sock size={88} />
              <h1 className="display mt-4 text-4xl leading-tight">The laundry room, minus the waiting around.</h1>
              <p className="muted mt-3">Join the line from your room. We'll tell you when a machine is yours.</p>
              <label className="mt-8 mb-2 font-bold" htmlFor="name">
                Your name
              </label>
              <input id="name" className="input" maxLength={20} autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" />
              <label className="mt-4 mb-2 font-bold" htmlFor="room">
                Room number
              </label>
              <input
                id="room"
                className="input num"
                inputMode="numeric"
                maxLength={3}
                autoComplete="off"
                value={room}
                onChange={(e) => setRoom(e.target.value.replace(/\D/g, '').slice(0, 3))}
                placeholder="e.g. 304"
                aria-describedby="room-hint"
              />
              <p id="room-hint" className="muted mt-2 text-sm">
                3 digits, first digit is your floor (1–8). Up to 2 people per room.
              </p>
              {err && <p className="mt-2 text-sm font-bold text-[var(--fin)]">{err}</p>}
              <div className="flex-1" />
              <button className="btn btn-primary btn-lg mt-8" disabled={busy || name.trim().length < 2 || !roomOk}>
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </form>
          )}

          {step === 'new' && (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                void register();
              }}
            >
              <h1 className="display text-4xl">New here?</h1>
              <p className="muted mt-2">
                No one called <b>{name.trim()}</b> in room <b className="num">{room}</b> yet. Pick a symbol and you're in. Next time, log in with the same name and room.
              </p>
              <p className="mt-6 mb-2 font-bold">Pick a symbol</p>
              <div className="emoji-grid" role="group" aria-label="Symbol">
                {EMOJI.map((e) => (
                  <button key={e} type="button" aria-pressed={e === emoji} onClick={() => setEmoji(e)}>
                    {e}
                  </button>
                ))}
              </div>
              {err && <p className="mt-3 text-sm font-bold text-[var(--fin)]">{err}</p>}
              <div className="flex-1" />
              <button className="btn btn-primary btn-lg mt-8" disabled={busy}>
                {busy ? 'Joining…' : `Join as ${emoji} ${name.trim()} · ${room}`}
              </button>
              <button type="button" className="btn btn-ghost mt-2" onClick={() => go('login')}>
                Back, I typed it wrong
              </button>
            </form>
          )}

          {step === 'alerts' && <AlertsStep onDone={() => signIn(token)} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AlertsStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState(pushState());
  const m = mode();
  const canInstall = useSyncExternalStore(onInstallChange, canPromptInstall);
  const enable = async () => {
    void unlockAudio().catch(() => {});
    setState(await enablePush());
  };
  return (
    <div className="flex flex-1 flex-col">
      <h1 className="display text-4xl">Don't miss your turn</h1>
      <p className="muted mt-2">A machine is only held for you for a few minutes. Alerts tell you the moment it's yours, even with the app closed.</p>
      <div className="card mt-6 p-4">
        {state === 'needs-install' ? (
          <>
            <p className="font-bold">On iPhone, add SudsQueue to your Home Screen first</p>
            <ol className="muted mt-2 list-decimal space-y-1 pl-5 text-sm">
              <li>Tap the Share button in Safari</li>
              <li>Choose “Add to Home Screen”</li>
              <li>Open SudsQueue from your Home Screen and turn alerts on in the menu</li>
            </ol>
          </>
        ) : state === 'granted' ? (
          <p className="font-bold text-[var(--free)]">✓ Alerts are on for this device</p>
        ) : state === 'denied' ? (
          <p className="text-sm">Alerts are blocked for this site. You can allow them in your browser's site settings later.</p>
        ) : state === 'unsupported' ? (
          <p className="text-sm">This browser can't show alerts. Keep the app open while you wait, and we'll chime.</p>
        ) : (
          <button className="btn btn-primary btn-lg" onClick={enable}>
            Turn on alerts
          </button>
        )}
        {m === 'android-tab' &&
          (canInstall ? (
            <button className="btn btn-secondary mt-3 w-full" onClick={promptInstall}>
              Install the app on this phone
            </button>
          ) : (
            <p className="muted mt-3 text-sm">Tip: choose “Install app” in the browser menu for the most reliable alerts.</p>
          ))}
      </div>
      <div className="flex-1" />
      <button className="btn btn-primary btn-lg mt-8" onClick={onDone}>
        {state === 'granted' ? "Let's go" : 'Continue'}
      </button>
    </div>
  );
}
