import { MACHINE_TYPES, type MachineType } from '@suds/shared';
import { useEffect, useState } from 'react';
import { FullScreen, Seg } from '../components/ui';
import { ago, hm, typeLabel, typeOne } from '../lib/format';
import { command, serverNow, toast, useStore } from '../lib/store';

type Tab = 'machines' | 'queues' | 'users' | 'settings' | 'log' | 'demo';

export function Admin({ open, onClose }: { open: boolean; onClose: () => void }) {
  const demo = useStore((s) => s.snap?.demo);
  const [tab, setTab] = useState<Tab>('machines');
  const tabs: Tab[] = ['machines', 'queues', 'users', 'settings', 'log', ...(demo ? (['demo'] as Tab[]) : [])];
  return (
    <FullScreen open={open} onClose={onClose} title="Admin">
      <div className="tabs mb-4" role="tablist">
        {tabs.map((t) => (
          <button key={t} role="tab" aria-pressed={tab === t} aria-selected={tab === t} onClick={() => setTab(t)} className="capitalize">
            {t === 'log' ? 'Audit log' : t}
          </button>
        ))}
      </div>
      {tab === 'machines' && <Machines />}
      {tab === 'queues' && <Queues />}
      {tab === 'users' && <Users />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'log' && <Log />}
      {tab === 'demo' && <Demo />}
    </FullScreen>
  );
}

function Machines() {
  const machines = useStore((s) => s.snap?.machines ?? []);
  const [retired, setRetired] = useState<{ id: string; type: MachineType; label: string }[]>([]);
  const [edit, setEdit] = useState<{ id: string; label: string } | null>(null);
  const [add, setAdd] = useState<{ type: MachineType; label: string } | null>(null);
  const loadRetired = () => command<typeof retired>('listRetired', {}, { quiet: true }).then((a) => a.ok && setRetired(a.data ?? []));
  useEffect(() => {
    void loadRetired();
  }, []);
  const act = async (type: Parameters<typeof command>[0], input: object) => {
    const a = await command(type, input);
    if (a.ok) void loadRetired();
    return a.ok;
  };

  return (
    <div className="grid gap-5">
      {MACHINE_TYPES.map((type) => {
        const ms = machines.filter((m) => m.type === type);
        return (
          <section key={type} className="card px-4 pt-3 pb-1">
            <div className="flex items-center justify-between">
              <h2 className="display text-xl">{typeLabel[type]}</h2>
              <button className="btn btn-ghost btn-sm" onClick={() => setAdd({ type, label: `${typeOne[type][0].toUpperCase()}${typeOne[type].slice(1)} ${ms.length + 1}` })}>
                + Add
              </button>
            </div>
            {add?.type === type && (
              <form
                className="flex gap-2 py-2"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (await act('addMachine', add)) setAdd(null);
                }}
              >
                <input className="input" autoFocus maxLength={24} value={add.label} onChange={(e) => setAdd({ ...add, label: e.target.value })} aria-label="New machine name" />
                <button className="btn btn-primary">Add</button>
                <button type="button" className="btn btn-ghost" onClick={() => setAdd(null)}>
                  Cancel
                </button>
              </form>
            )}
            {ms.map((m, i) => (
              <div key={m.id} className="list-row">
                {edit?.id === m.id ? (
                  <form
                    className="flex flex-1 gap-2"
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (await act('renameMachine', { machineId: m.id, label: edit.label })) setEdit(null);
                    }}
                  >
                    <input className="input" autoFocus maxLength={24} value={edit.label} onChange={(e) => setEdit({ ...edit, label: e.target.value })} aria-label="Machine name" />
                    <button className="btn btn-primary">Save</button>
                  </form>
                ) : (
                  <>
                    <button className="flex-1 text-left font-bold" onClick={() => setEdit({ id: m.id, label: m.label })} title="Rename">
                      {m.label} <span className="pill ml-1" data-s={m.state}>{m.state === 'OCCUPIED_UNKNOWN' ? 'In use' : m.state.toLowerCase().replace('_', ' ')}</span>
                    </button>
                    <button className="icon-btn" disabled={i === 0} onClick={() => act('moveMachine', { machineId: m.id, dir: -1 })} aria-label={`Move ${m.label} up`}>
                      ▲
                    </button>
                    <button className="icon-btn" disabled={i === ms.length - 1} onClick={() => act('moveMachine', { machineId: m.id, dir: 1 })} aria-label={`Move ${m.label} down`}>
                      ▼
                    </button>
                    <button className="btn btn-danger btn-sm" onClick={() => confirm(`Retire ${m.label}? Anyone using it keeps their place in line.`) && act('retireMachine', { machineId: m.id })}>
                      Retire
                    </button>
                  </>
                )}
              </div>
            ))}
          </section>
        );
      })}
      {retired.length > 0 && (
        <section className="card px-4 pt-3 pb-1">
          <h2 className="display text-xl">Retired</h2>
          {retired.map((m) => (
            <div key={m.id} className="list-row">
              <span className="muted flex-1 font-bold">
                {m.label} · {typeOne[m.type]}
              </span>
              <button className="btn btn-secondary btn-sm" onClick={() => act('restoreMachine', { machineId: m.id })}>
                Restore
              </button>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

function Queues() {
  const queues = useStore((s) => s.snap?.queues);
  if (!queues) return null;
  return (
    <div className="grid gap-4">
      {MACHINE_TYPES.map((type) => (
        <section key={type} className="card px-4 pt-3 pb-1">
          <h2 className="display text-xl">{typeOne[type]} line</h2>
          {queues[type].length === 0 && <p className="muted py-3 text-sm">Nobody waiting.</p>}
          {queues[type].map((e, i) => (
            <div key={e.userId} className="list-row">
              <span className="flex-1 font-bold">
                {i + 1}. {e.emoji} {e.name} <span className="muted text-sm font-medium">· {e.status}{e.missed ? ` · missed ${e.missed}` : ''}</span>
              </span>
              <button className="btn btn-danger btn-sm" onClick={() => confirm(`Remove ${e.name} from the line?`) && command('removeFromQueue', { userId: e.userId, type })}>
                Remove
              </button>
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

interface UserRow {
  id: number;
  name: string;
  emoji: string;
  mutedUntil: number | null;
  lastActive: number | null;
}

function Users() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const load = () => command<UserRow[]>('listUsers', {}, { quiet: true }).then((a) => a.ok && setUsers(a.data ?? []));
  useEffect(() => {
    void load();
  }, []);
  const now = serverNow();
  const mute = async (userId: number, minutes: number) => {
    if ((await command('mute', { userId, minutes })).ok) void load();
  };
  return (
    <section className="card px-4 pt-1 pb-1">
      {users.map((u) => {
        const muted = (u.mutedUntil ?? 0) > now;
        return (
          <div key={u.id} className="list-row">
            <div className="flex-1">
              <p className="font-bold">
                {u.emoji} {u.name}
              </p>
              <p className="muted text-xs">
                {muted ? `Muted until ${hm(u.mutedUntil!)}` : u.lastActive ? `Active ${ago(now - u.lastActive)} ago` : 'Never active'}
              </p>
            </div>
            {muted ? (
              <button className="btn btn-secondary btn-sm" onClick={() => mute(u.id, 0)}>
                Unmute
              </button>
            ) : (
              <>
                <button className="btn btn-secondary btn-sm" onClick={() => mute(u.id, 60)}>
                  Mute 1 h
                </button>
                <button className="btn btn-secondary btn-sm" onClick={() => mute(u.id, 60 * 24)}>
                  1 day
                </button>
              </>
            )}
          </div>
        );
      })}
    </section>
  );
}

function SettingsTab() {
  const s = useStore((x) => x.snap?.settings);
  const [f, setF] = useState(() => (s ? { quietStart: s.quietStart, quietEnd: s.quietEnd, tz: s.tz, linksAllowed: s.linksAllowed, windowMin: s.windowMin } : null));
  const [code, setCode] = useState('');
  if (!f) return null;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((await command('setSettings', f)).ok) toast('Settings saved');
  };
  return (
    <div className="grid gap-4">
      <form className="card grid gap-4 p-4" onSubmit={save}>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-1 font-bold">
            Quiet from
            <input type="time" className="input" value={f.quietStart} onChange={(e) => setF({ ...f, quietStart: e.target.value })} />
          </label>
          <label className="grid gap-1 font-bold">
            Quiet until
            <input type="time" className="input" value={f.quietEnd} onChange={(e) => setF({ ...f, quietEnd: e.target.value })} />
          </label>
        </div>
        <label className="grid gap-1 font-bold">
          Time zone
          <input className="input" value={f.tz} onChange={(e) => setF({ ...f, tz: e.target.value })} placeholder="Europe/Berlin" />
        </label>
        <div className="grid gap-2">
          <span className="font-bold">Minutes to load a held machine</span>
          <Seg label="Hold window" options={[5, 10, 15, 20]} value={f.windowMin} onChange={(v) => setF({ ...f, windowMin: v })} fmt={(v) => `${v} min`} />
        </div>
        <label className="flex items-center gap-3 font-bold">
          <input type="checkbox" checked={f.linksAllowed} onChange={(e) => setF({ ...f, linksAllowed: e.target.checked })} /> Allow links on the board
        </label>
        <button className="btn btn-primary btn-lg">Save settings</button>
      </form>
      <form
        className="card grid gap-3 p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if ((await command('rotateCode', { code })).ok) {
            toast('Dorm code changed. Existing residents stay signed in.');
            setCode('');
          }
        }}
      >
        <label className="grid gap-1 font-bold">
          New dorm code
          <input className="input" minLength={4} maxLength={32} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" />
        </label>
        <button className="btn btn-secondary" disabled={code.trim().length < 4}>
          Change dorm code
        </button>
      </form>
    </div>
  );
}

interface LogRow {
  id: number;
  at: number;
  action: string;
  machineId: string | null;
  detail: string | null;
  userName: string | null;
}

function Log() {
  const tz = useStore((s) => s.snap?.settings.tz);
  const [rows, setRows] = useState<LogRow[]>([]);
  const [more, setMore] = useState(true);
  const load = async (before?: number) => {
    const a = await command<LogRow[]>('auditLog', { before, limit: 100 }, { quiet: true });
    if (!a.ok) return;
    const r = a.data ?? [];
    setRows((x) => (before ? [...x, ...r] : r));
    setMore(r.length === 100);
  };
  useEffect(() => {
    void load();
  }, []);
  return (
    <section className="card px-4 pt-1 pb-3">
      {rows.map((r) => (
        <div key={r.id} className="list-row text-sm">
          <span className="muted num w-24 flex-none">
            {new Date(r.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: tz })} {hm(r.at, tz)}
          </span>
          <span className="flex-1">
            <b>{r.userName ?? 'System'}</b> {r.action.replace(/_/g, ' ')}
            {r.machineId ? ` · ${r.machineId}` : ''}
          </span>
        </div>
      ))}
      {more && rows.length > 0 && (
        <button className="btn btn-ghost mt-2 w-full" onClick={() => load(rows[rows.length - 1].id)}>
          Load older
        </button>
      )}
    </section>
  );
}

function Demo() {
  return (
    <section className="card grid gap-3 p-4">
      <p className="muted text-sm">Demo mode: move the server clock forward to see timers, reminders and missed turns play out.</p>
      <div className="flex flex-wrap gap-2">
        {[1, 5, 10, 30, 60].map((m) => (
          <button key={m} className="btn btn-secondary" onClick={() => command('demoForward', { minutes: m })}>
            +{m} min
          </button>
        ))}
      </div>
    </section>
  );
}
