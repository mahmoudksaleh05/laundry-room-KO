import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { TurnModal } from './components/TurnModal';
import { BubbleField, Sock, Toasts } from './components/ui';
import { enablePush, pushState, reRegisterPush } from './lib/push';
import { prefs } from './lib/storage';
import { useNow, useStore } from './lib/store';
import { hm } from './lib/format';
import { Admin } from './screens/Admin';
import { Board } from './screens/Board';
import { Laundry } from './screens/Laundry';
import { Menu } from './screens/Menu';
import { Onboarding } from './screens/Onboarding';

type TabName = 'laundry' | 'board';

export function App() {
  const status = useStore((s) => s.status);
  const ready = useStore((s) => !!s.snap && !!s.me);
  return (
    <>
      <BubbleField />
      <div className="app">
        {status === 'signed-out' ? <Onboarding /> : ready ? <Main /> : <Splash offline={status === 'offline'} />}
      </div>
      <Toasts />
    </>
  );
}

function Splash({ offline }: { offline: boolean }) {
  return (
    <div className="grid min-h-dvh place-items-center text-center">
      <div>
        <Sock size={96} />
        <p className="display mt-3 text-2xl">{offline ? "Can't reach the laundry room" : 'Warming up…'}</p>
        {offline && <p className="muted mt-1 text-sm">We'll reconnect as soon as you're back online.</p>}
      </div>
    </div>
  );
}

function Main() {
  const status = useStore((s) => s.status);
  const me = useStore((s) => s.me)!;
  const snap = useStore((s) => s.snap)!;
  const chat = useStore((s) => s.chat);
  const vapidKey = useStore((s) => s.vapidKey);
  const [tab, setTab] = useState<TabName>('laundry');
  const [menu, setMenu] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [turnId, setTurnId] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [seen, setSeen] = useState(() => prefs.get('seenMsg', 0));
  const [alerts, setAlerts] = useState(pushState());

  useEffect(() => {
    if (vapidKey) void reRegisterPush();
  }, [vapidKey]);

  // A machine just got reserved for me: open the turn screen once per reservation.
  const reserved = snap.machines.find((m) => m.state === 'RESERVED' && m.owner?.id === me.id);
  useEffect(() => {
    if (!reserved) {
      setDismissed(null);
      if (turnId) setTurnId(null);
    } else if (dismissed !== reserved.id && turnId !== reserved.id) setTurnId(reserved.id);
  }, [reserved?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Unread notes from others, cleared while the board is visible.
  const lastId = chat.reduce((x, m) => Math.max(x, m.id), 0);
  const boardVisible = tab === 'board' || matchMedia('(min-width: 1024px)').matches;
  useEffect(() => {
    if (boardVisible && lastId > seen) {
      setSeen(lastId);
      prefs.set('seenMsg', lastId);
    }
  }, [boardVisible, lastId, seen]);
  const unread = chat.filter((m) => m.id > seen && m.kind !== 'system' && m.user?.id !== me.id).length;

  const turn = snap.machines.find((m) => m.id === turnId && m.state === 'RESERVED' && m.owner?.id === me.id);
  const closeTurn = () => {
    setDismissed(turnId);
    setTurnId(null);
  };

  return (
    <>
      <header className="topbar">
        <div className="inner">
          <span className="display brand flex-1">
            <span aria-hidden>🫧</span> SudsQueue
          </span>
          <BudapestClock />
          <span className={`live${status === 'live' ? '' : ' off'}`}>
            <i /> {status === 'live' ? 'Live' : 'Reconnecting'}
          </span>
          <button className="icon-btn" onClick={() => setMenu(true)} aria-label="Menu">
            <span className="text-2xl" aria-hidden>
              {me.emoji}
            </span>
          </button>
        </div>
      </header>
      {status !== 'live' && <div className="reconnect">Offline. Showing the last known state.</div>}

      <main className="shell">
        <div>
          {alerts === 'default' && (
            <div className="banner mb-3">
              <span aria-hidden>🔔</span>
              <span className="flex-1">Turn on alerts so you don't miss your turn.</span>
              <button className="btn btn-primary btn-sm" onClick={async () => setAlerts(await enablePush())}>
                Turn on
              </button>
            </div>
          )}
          {snap.demo && <div className="banner mb-3">Demo mode: the clock can be moved forward from Admin.</div>}
          {tab === 'laundry' ? <Laundry onTurn={setTurnId} /> : <Board page />}
        </div>
        <aside className="side-board">
          <Board />
        </aside>
      </main>

      <nav className="tabbar" aria-label="Sections">
        {(['laundry', 'board'] as TabName[]).map((t) => (
          <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => setTab(t)}>
            {tab === t && <motion.span layoutId="tab-bg" className="tab-bg" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />}
            {t === 'laundry' ? '🧺 Laundry' : '📌 Board'}
            {t === 'board' && unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
          </button>
        ))}
      </nav>

      {turn && <TurnModal key={turn.id} m={turn} settings={snap.settings} onClose={closeTurn} />}
      <Menu open={menu} onClose={() => setMenu(false)} onAdmin={() => setAdmin(true)} />
      <Admin open={admin && me.isAdmin} onClose={() => setAdmin(false)} />
    </>
  );
}

/** Server-synced clock, Budapest time. */
function BudapestClock() {
  const now = useNow();
  return (
    <time className="num mr-2 text-sm font-bold" dateTime={new Date(now).toISOString()} title="Budapest time">
      {hm(now)}
    </time>
  );
}
