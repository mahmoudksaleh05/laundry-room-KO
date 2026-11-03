import type { ChatMessage } from '@suds/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EmptyState, Sheet } from '../components/ui';
import { ago, hm } from '../lib/format';
import { command, serverNow, toast, useStore } from '../lib/store';

const tilt = (id: number) => `${(((id * 37) % 5) - 2) * 0.35}deg`;

export function Board({ page }: { page?: boolean }) {
  const chat = useStore((s) => s.chat);
  const me = useStore((s) => s.me)!;
  const tz = useStore((s) => s.snap?.settings.tz);
  const [text, setText] = useState('');
  const [announce, setAnnounce] = useState(false);
  const [menu, setMenu] = useState<ChatMessage | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const now = serverNow();
  const pinned = chat.filter((m) => m.kind === 'announcement' && (m.pinnedUntil ?? 0) > now);
  const flow = chat.filter((m) => !pinned.includes(m));
  const muted = (me.mutedUntil ?? 0) > now;

  // Keep the newest note in view as messages arrive.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [flow.length]);

  // Phones: shrink the board when the keyboard opens so the composer stays visible.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv || !page) return;
    const f = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, innerHeight - vv.height)}px`);
    vv.addEventListener('resize', f);
    return () => {
      vv.removeEventListener('resize', f);
      document.documentElement.style.removeProperty('--kb');
    };
  }, [page]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    const ack = await command('sendMessage', { text: t, announce });
    if (ack.ok) {
      setText('');
      setAnnounce(false);
    }
  };

  return (
    <div className={`board${page ? ' page' : ''}`}>
      <div className="board-head">
        <h2 className="display text-2xl">Board</h2>
        <span className="muted text-xs font-bold">Last 48 hours</span>
      </div>
      {pinned.length > 0 && (
        <div className="pinned" aria-label="Announcements">
          {pinned.map((m) => (
            <Note key={m.id} m={m} tz={tz} own={false} onMenu={() => setMenu(m)} />
          ))}
        </div>
      )}
      <div className="board-scroll" ref={scroller} aria-live="polite">
        {flow.length === 0 && <EmptyState title="Nothing pinned yet">Say hi, or let people know if you left a sock behind.</EmptyState>}
        {flow.map((m) =>
          m.kind === 'system' ? (
            <p key={m.id} className="sysmsg">
              {m.text} · {hm(m.at, tz)}
            </p>
          ) : (
            <Note key={m.id} m={m} tz={tz} own={m.user?.id === me.id} onMenu={() => setMenu(m)} />
          ),
        )}
      </div>
      <form className="composer" onSubmit={send}>
        <div className="grid flex-1 gap-1">
          <input
            className="input"
            value={text}
            maxLength={280}
            disabled={muted}
            onChange={(e) => setText(e.target.value)}
            placeholder={muted ? 'You are muted for now' : 'Write a note…'}
            aria-label="Message"
            enterKeyHint="send"
          />
          {me.isAdmin && (
            <label className="muted flex items-center gap-2 px-1 text-xs font-bold">
              <input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Pin as announcement (24 h)
            </label>
          )}
        </div>
        <button className="btn btn-primary self-start" disabled={!text.trim() || muted} aria-label="Send">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M13 6l6 6-6 6" />
          </svg>
        </button>
      </form>
      <NoteMenu m={menu} meId={me.id} isAdmin={me.isAdmin} onClose={() => setMenu(null)} />
    </div>
  );
}

function Note({ m, tz, own, onMenu }: { m: ChatMessage; tz?: string; own: boolean; onMenu: () => void }) {
  return (
    <article className={`note${own ? ' own' : ''}`} style={{ '--r': tilt(m.id) } as React.CSSProperties}>
      <div className="who pr-7">
        <span aria-hidden>{m.user?.emoji ?? '📌'}</span>
        {m.user?.name ?? 'Admin'}
        {m.kind === 'announcement' && <span className="badge">notice</span>}
        <span className="when" title={hm(m.at, tz)}>
          {ago(serverNow() - m.at)}
        </span>
      </div>
      <p className="txt">{m.text}</p>
      <button className="more" onClick={onMenu} aria-label="Note options">
        ···
      </button>
    </article>
  );
}

function NoteMenu({ m, meId, isAdmin, onClose }: { m: ChatMessage | null; meId: number; isAdmin: boolean; onClose: () => void }) {
  const act = async (type: 'reportMessage' | 'deleteMessage' | 'unpin') => {
    if (!m) return;
    const ack = await command(type, { messageId: m.id });
    if (ack.ok) {
      if (type === 'reportMessage') toast('Thanks. An admin will take a look.');
      onClose();
    }
  };
  return (
    <Sheet open={!!m} onClose={onClose} title="Note">
      <p className="muted mb-4 line-clamp-3 text-sm">“{m?.text}”</p>
      <div className="grid gap-2">
        {m && m.user?.id !== meId && (
          <button className="btn btn-secondary" onClick={() => act('reportMessage')}>
            Report this note
          </button>
        )}
        {isAdmin && m?.kind === 'announcement' && (
          <button className="btn btn-secondary" onClick={() => act('unpin')}>
            Unpin
          </button>
        )}
        {isAdmin && (
          <button className="btn btn-danger" onClick={() => act('deleteMessage')}>
            Delete {m && m.reports > 0 ? `(${m.reports} reports)` : ''}
          </button>
        )}
        <button className="btn btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
    </Sheet>
  );
}
