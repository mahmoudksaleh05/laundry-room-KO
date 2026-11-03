import { errorText } from '@suds/shared';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { FullScreen, Sheet } from '../components/ui';
import { canPromptInstall, isStandalone, mode, onInstallChange, promptInstall } from '../lib/platform';
import { enablePush, pushState, type PushState } from '../lib/push';
import { audioState, chime, unlockAudio, vibrate } from '../lib/sound';
import { prefs } from '../lib/storage';
import { api, command, signOut, toast, useStore } from '../lib/store';

type Theme = 'system' | 'light' | 'dark';

export function Menu({ open, onClose, onAdmin }: { open: boolean; onClose: () => void; onAdmin: () => void }) {
  const me = useStore((s) => s.me);
  const [theme, setTheme] = useState<Theme>(prefs.get('theme', 'system'));
  const [push, setPush] = useState<PushState>(pushState());
  const [sounds, setSounds] = useState(prefs.get('sounds', true));
  const [pin, setPin] = useState(false);
  const [test, setTest] = useState(false);
  const [del, setDel] = useState(false);
  const canInstall = useSyncExternalStore(onInstallChange, canPromptInstall);

  useEffect(() => {
    if (open) setPush(pushState());
  }, [open]);

  const applyTheme = (t: Theme) => {
    setTheme(t);
    prefs.set('theme', t);
    if (t === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
  };

  const toggleSounds = async () => {
    const on = !sounds;
    setSounds(on);
    prefs.set('sounds', on);
    if (on) await unlockAudio().catch(() => {});
  };

  if (!me) return null;
  return (
    <FullScreen open={open} onClose={onClose} title="Menu">
      <div className="card mb-4 flex items-center gap-3 p-4">
        <span className="text-3xl" aria-hidden>
          {me.emoji}
        </span>
        <div className="flex-1">
          <p className="font-bold">{me.name}</p>
          <p className="muted text-sm">Room {me.room} · {me.isAdmin ? 'Admin mode on this device' : 'Resident'}</p>
        </div>
      </div>

      <div className="card mb-4 px-4">
        <div className="list-row">
          <span className="flex-1 font-bold">Theme</span>
          <div className="seg">
            {(['system', 'light', 'dark'] as Theme[]).map((t) => (
              <button key={t} aria-pressed={theme === t} onClick={() => applyTheme(t)} className="capitalize">
                {t === 'system' ? 'Auto' : t}
              </button>
            ))}
          </div>
        </div>
        <div className="list-row">
          <div className="flex-1">
            <p className="font-bold">Alerts</p>
            <p className="muted text-sm">
              {push === 'granted'
                ? 'On for this device'
                : push === 'denied'
                  ? 'Blocked in browser settings'
                  : push === 'needs-install'
                    ? 'Add to Home Screen first'
                    : push === 'unsupported'
                      ? 'Not available in this browser'
                      : 'Off'}
            </p>
          </div>
          {push === 'default' && (
            <button className="btn btn-primary btn-sm" onClick={async () => setPush(await enablePush())}>
              Turn on
            </button>
          )}
        </div>
        <div className="list-row">
          <div className="flex-1">
            <p className="font-bold">Sounds</p>
            <p className="muted text-sm">A chime when it's your turn (app open)</p>
          </div>
          <button className="btn btn-secondary btn-sm" role="switch" aria-checked={sounds} onClick={toggleSounds}>
            {sounds ? 'On' : 'Off'}
          </button>
        </div>
        {!isStandalone() && (
          <div className="list-row">
            <div className="flex-1">
              <p className="font-bold">Install the app</p>
              <p className="muted text-sm">
                {mode() === 'ios-tab' ? 'Safari: Share → Add to Home Screen' : canInstall ? 'Opens like an app, alerts are more reliable' : 'Use your browser menu → Install app'}
              </p>
            </div>
            {canInstall && (
              <button className="btn btn-secondary btn-sm" onClick={promptInstall}>
                Install
              </button>
            )}
          </div>
        )}
        <div className="list-row">
          <span className="flex-1 font-bold">Test this device</span>
          <button className="btn btn-secondary btn-sm" onClick={() => setTest(true)}>
            Run test
          </button>
        </div>
      </div>

      <div className="card mb-4 px-4">
        {me.isAdmin ? (
          <>
            <div className="list-row">
              <span className="flex-1 font-bold">Admin tools</span>
              <button className="btn btn-primary btn-sm" onClick={onAdmin}>
                Open
              </button>
            </div>
            <div className="list-row">
              <span className="flex-1 font-bold">Leave admin mode</span>
              <button className="btn btn-secondary btn-sm" onClick={() => command('exitAdmin')}>
                Exit
              </button>
            </div>
          </>
        ) : (
          <div className="list-row">
            <span className="flex-1 font-bold">I'm an admin</span>
            <button className="btn btn-secondary btn-sm" onClick={() => setPin(true)}>
              Enter PIN
            </button>
          </div>
        )}
        <div className="list-row">
          <span className="flex-1 font-bold text-[var(--fin)]">Delete my data</span>
          <button className="btn btn-danger btn-sm" onClick={() => setDel(true)}>
            Delete
          </button>
        </div>
      </div>
      <p className="muted px-1 text-xs">
        SudsQueue stores your name, room number, symbol, laundry activity and board notes for this dorm. Notes are removed after 2 days, the activity log after
        30 days, and accounts inactive for 60 days are deleted. Build {__BUILD__}.
      </p>

      <PinSheet open={pin} onClose={() => setPin(false)} />
      <DeviceTest open={test} onClose={() => setTest(false)} />
      <Sheet open={del} onClose={() => setDel(false)} title="Delete your data?">
        <p className="muted mb-5">This removes your account, your place in any line and your notes. It can't be undone.</p>
        <button
          className="btn btn-danger btn-lg border border-[var(--fin)]"
          onClick={async () => {
            const r = await api('DELETE', '/api/me');
            if (r.ok) signOut();
            else toast(errorText(r.code));
          }}
        >
          Delete everything
        </button>
      </Sheet>
    </FullScreen>
  );
}

function PinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!open) {
      setPin('');
      setErr('');
    }
  }, [open]);
  const submit = async (p: string) => {
    const r = await api('POST', '/api/admin/login', { pin: p });
    if (r.ok) {
      toast('Admin mode on for 8 hours');
      onClose();
    } else {
      setErr(errorText(r.code));
      setPin('');
    }
  };
  const press = (k: string) => {
    if (k === '⌫') return setPin((p) => p.slice(0, -1));
    const next = (pin + k).slice(0, 12);
    setPin(next);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Admin PIN">
      <div className="mb-4 flex h-8 items-center justify-center gap-2" aria-label={`${pin.length} digits entered`}>
        {pin.split('').map((_, i) => (
          <i key={i} className="block h-3 w-3 rounded-full bg-[var(--ink)]" />
        ))}
      </div>
      {err && <p className="mb-3 text-center text-sm font-bold text-[var(--fin)]">{err}</p>}
      <div className="pinpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map((k) => (
          <button
            key={k}
            aria-label={k === '⌫' ? 'Delete' : k === '✓' ? 'Submit' : k}
            onClick={() => (k === '✓' ? pin && submit(pin) : press(k))}
            className={k === '✓' ? '!bg-[var(--accent)] !text-[var(--on-accent)]' : ''}
          >
            {k}
          </button>
        ))}
      </div>
    </Sheet>
  );
}

function DeviceTest({ open, onClose }: { open: boolean; onClose: () => void }) {
  const status = useStore((s) => s.status);
  const offset = useStore((s) => s.offset);
  const [log, setLog] = useState<string[]>([]);
  const add = (l: string) => setLog((x) => [...x, l]);
  const run = async () => {
    setLog([]);
    add(status === 'live' ? '✓ Live connection to the laundry room' : '✗ Not connected right now');
    add(Math.abs(offset) < 5000 ? '✓ Clock in sync' : `! Your clock is ${Math.round(offset / 1000)} s off (we correct for it)`);
    await unlockAudio().catch(() => {});
    chime();
    add(audioState() === 'on' ? '✓ Chime played (did you hear it?)' : '✗ Sound is blocked');
    add(vibrate([120]) ? '✓ Vibration sent' : '– No vibration on this device');
    const p = pushState();
    if (p === 'granted') {
      const r = await api('POST', '/api/push/test');
      add(r.ok ? '✓ Test alert sent, it should arrive in a few seconds' : '✗ Could not send a test alert');
    } else add(`– Alerts: ${p === 'needs-install' ? 'add to Home Screen first' : p}`);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Device test">
      <p className="muted mb-4 text-sm">Checks the connection, sound, vibration and alerts on this phone.</p>
      <ul className="mb-4 grid gap-1 text-sm font-semibold">
        {log.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
      <button className="btn btn-primary btn-lg" onClick={run}>
        {log.length ? 'Run again' : 'Start test'}
      </button>
    </Sheet>
  );
}
