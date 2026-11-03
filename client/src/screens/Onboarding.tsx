import { errorText } from '@suds/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { Sock } from '../components/ui';
import { mode } from '../lib/platform';
import { enablePush, pushState } from '../lib/push';
import { unlockAudio } from '../lib/sound';
import { api, signIn } from '../lib/store';

const EMOJI = ['🫧', '🧺', '🧦', '👕', '🌊', '🐙', '🦦', '🐳', '🌸', '🍋', '🌙', '⭐', '🍀', '🦊', '🐝', '🎧'];

type Step = 'code' | 'name' | 'ticket' | 'alerts' | 'recover';

export function Onboarding() {
  const [step, setStep] = useState<Step>('code');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [recovery, setRecovery] = useState('');
  const [token, setToken] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const order: Step[] = ['code', 'name', 'ticket', 'alerts'];

  const go = (s: Step) => {
    setErr('');
    setStep(s);
  };

  const register = async () => {
    setBusy(true);
    const r = await api<{ token: string; recoveryCode: string }>('POST', '/api/register', { code, name, emoji });
    setBusy(false);
    if (!r.ok) {
      if (r.code === 'BAD_CODE') go('code');
      return setErr(errorText(r.code));
    }
    setToken(r.data!.token);
    setRecovery(r.data!.recoveryCode);
    go('ticket');
  };

  const recover = async () => {
    setBusy(true);
    const r = await api<{ token: string }>('POST', '/api/recover', { code, name, recoveryCode: recovery.replace(/[\s-]/g, '').toUpperCase() });
    setBusy(false);
    if (!r.ok) return setErr(errorText(r.code));
    signIn(r.data!.token);
  };

  const finish = () => signIn(token);

  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col px-5 pt-[max(28px,env(safe-area-inset-top))] pb-[max(24px,env(safe-area-inset-bottom))]">
      <div className="mb-6 flex items-center justify-between">
        <span className="display brand">
          <span aria-hidden>🫧</span> SudsQueue
        </span>
        {step !== 'recover' && (
          <div className="dots" aria-hidden>
            {order.map((s) => (
              <i key={s} className={s === step ? 'on' : ''} />
            ))}
          </div>
        )}
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
          {step === 'code' && (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) go('name');
              }}
            >
              <Sock size={88} />
              <h1 className="display mt-4 text-4xl leading-tight">The laundry room, minus the waiting around.</h1>
              <p className="muted mt-3">Join the line from your room. We'll tell you when a machine is yours.</p>
              <label className="mt-8 mb-2 font-bold" htmlFor="code">
                Dorm code
              </label>
              <input id="code" className="input" autoComplete="off" autoCapitalize="characters" value={code} onChange={(e) => setCode(e.target.value)} placeholder="It's on the laundry room door" />
              {err && <p className="mt-2 text-sm font-bold text-[var(--fin)]">{err}</p>}
              <div className="flex-1" />
              <button className="btn btn-primary btn-lg mt-8" disabled={!code.trim()}>
                Continue
              </button>
              <button type="button" className="btn btn-ghost mt-2" onClick={() => go('recover')}>
                I already have an account
              </button>
            </form>
          )}

          {step === 'name' && (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                void register();
              }}
            >
              <h1 className="display text-4xl">What should neighbours call you?</h1>
              <p className="muted mt-2">First name or nickname. Others see it in the line.</p>
              <label className="mt-6 mb-2 font-bold" htmlFor="name">
                Name
              </label>
              <input id="name" className="input" maxLength={20} autoComplete="nickname" value={name} onChange={(e) => setName(e.target.value)} placeholder="Sam" />
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
              <button className="btn btn-primary btn-lg mt-8" disabled={busy || name.trim().length < 2}>
                {busy ? 'Joining…' : `Join as ${emoji} ${name.trim() || '…'}`}
              </button>
              <button type="button" className="btn btn-ghost mt-2" onClick={() => go('code')}>
                Back
              </button>
            </form>
          )}

          {step === 'ticket' && (
            <div className="flex flex-1 flex-col">
              <h1 className="display text-4xl">Keep this ticket</h1>
              <p className="muted mt-2">If you change phones or clear your browser, this code gets your account back. We can't show it again.</p>
              <div className="ticket mt-6">
                <p className="eyebrow">Recovery code for {name.trim()}</p>
                <p className="code num mt-2">
                  {recovery.slice(0, 4)}-{recovery.slice(4)}
                </p>
              </div>
              <button className="btn btn-secondary mt-3" onClick={() => navigator.clipboard?.writeText(recovery).catch(() => {})}>
                Copy code
              </button>
              <p className="muted mt-3 text-sm">A screenshot works too.</p>
              <div className="flex-1" />
              <button className="btn btn-primary btn-lg mt-8" onClick={() => go('alerts')}>
                I've saved it
              </button>
            </div>
          )}

          {step === 'alerts' && <AlertsStep onDone={finish} />}

          {step === 'recover' && (
            <form
              className="flex flex-1 flex-col"
              onSubmit={(e) => {
                e.preventDefault();
                void recover();
              }}
            >
              <h1 className="display text-4xl">Welcome back</h1>
              <p className="muted mt-2">Use the name you signed up with and your recovery code.</p>
              <label className="mt-6 mb-2 font-bold" htmlFor="rcode">
                Dorm code
              </label>
              <input id="rcode" className="input" autoComplete="off" value={code} onChange={(e) => setCode(e.target.value)} />
              <label className="mt-4 mb-2 font-bold" htmlFor="rname">
                Name
              </label>
              <input id="rname" className="input" value={name} onChange={(e) => setName(e.target.value)} />
              <label className="mt-4 mb-2 font-bold" htmlFor="rrec">
                Recovery code
              </label>
              <input id="rrec" className="input num" autoComplete="off" autoCapitalize="characters" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="ABCD-EFGH" />
              {err && <p className="mt-3 text-sm font-bold text-[var(--fin)]">{err}</p>}
              <div className="flex-1" />
              <button className="btn btn-primary btn-lg mt-8" disabled={busy || !code || !name || recovery.length < 8}>
                {busy ? 'Checking…' : 'Get my account back'}
              </button>
              <button type="button" className="btn btn-ghost mt-2" onClick={() => go('code')}>
                Back
              </button>
            </form>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function AlertsStep({ onDone }: { onDone: () => void }) {
  const [state, setState] = useState(pushState());
  const m = mode();
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
        {m === 'android-tab' && state !== 'needs-install' && <p className="muted mt-3 text-sm">Tip: install the app from the browser menu for the most reliable alerts.</p>}
      </div>
      <div className="flex-1" />
      <button className="btn btn-primary btn-lg mt-8" onClick={onDone}>
        {state === 'granted' ? "Let's go" : 'Continue'}
      </button>
    </div>
  );
}
