import type { MachineView } from '@suds/shared';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBackClose } from '../lib/back';
import { stateLabel } from '../lib/format';
import { useStore } from '../lib/store';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Bottom sheet on phones, centred dialog from 768px. Back closes it. */
export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode }) {
  useBackClose(open, onClose);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="backdrop" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <div className="sheet-wrap">
            <motion.div
              className="sheet"
              role="dialog"
              aria-modal="true"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            >
              <div className="grab" />
              {title && <h2 className="display mb-3 text-2xl">{title}</h2>}
              {children}
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/** Full-screen page (menu, admin). Back closes it. */
export function FullScreen({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useBackClose(open, onClose);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fullscreen" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 16 }}>
          <div className="wrap">
            <div className="mb-4 flex items-center gap-2">
              <button className="icon-btn" onClick={onClose} aria-label="Back">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M15 5l-7 7 7 7" />
                </svg>
              </button>
              <h1 className="display text-3xl">{title}</h1>
            </div>
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className="toast" initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function StatePill({ m, now, urgent }: { m: MachineView; now: number; urgent?: boolean }) {
  return (
    <span className={`pill${urgent ? ' urgent' : ''}`} data-s={m.state}>
      {stateLabel(m, now)}
    </span>
  );
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The soap bubbles drifting up behind everything. 14 on desktop, 8 on phones (CSS). */
export function BubbleField() {
  const bubbles = useMemo(
    () =>
      Array.from({ length: 14 }, (_, i) => {
        const s = rand(18, i % 4 === 0 ? 96 : 56);
        return {
          '--x': `${rand(0, 100)}%`,
          '--y': `${rand(5, 90)}%`,
          '--s': `${s}px`,
          '--d': `${rand(18, 34)}s`,
          '--delay': `${-rand(0, 34)}s`,
          '--drift': `${rand(-40, 40)}px`,
          '--blur': s > 70 ? 'blur(1.5px)' : 'none',
        } as React.CSSProperties;
      }),
    [],
  );
  const [paused, setPaused] = useState(document.hidden);
  useEffect(() => {
    const f = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', f);
    return () => document.removeEventListener('visibilitychange', f);
  }, []);
  return (
    <div className={`bubbles${paused ? ' paused' : ''}`} aria-hidden="true">
      {bubbles.map((style, i) => (
        <span key={i} style={style} />
      ))}
    </div>
  );
}

/** The "your turn" celebration: bubbles bursting outward. */
export function BubbleBurst() {
  const parts = useMemo(
    () =>
      reduced()
        ? []
        : Array.from({ length: 18 }, (_, i) => {
            const a = (i / 18) * Math.PI * 2 + rand(-0.2, 0.2);
            const d = rand(90, 190);
            return {
              '--s': `${rand(12, 34)}px`,
              '--dx': `${Math.cos(a) * d}px`,
              '--dy': `${Math.sin(a) * d - 40}px`,
              '--delay': `${rand(0, 0.25)}s`,
            } as React.CSSProperties;
          }),
    [],
  );
  return (
    <div className="burst" aria-hidden="true">
      {parts.map((style, i) => (
        <span key={i} style={style} />
      ))}
    </div>
  );
}

/** Sudsy the sock: the mascot for empty and friendly states. */
export function Sock({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <path
        d="M30 8h22v34c0 4 2 7 6 10 8 6 6 20-6 20-6 0-10-3-15-8L24 52c-4-4-5-8-5-12V8z"
        fill="var(--surface)"
        stroke="var(--ink)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        transform="translate(4 0)"
      />
      <path d="M23 8h26v8H23z" fill="var(--accent)" stroke="var(--ink)" strokeWidth="2.4" strokeLinejoin="round" transform="translate(4 0)" />
      <circle cx="36" cy="32" r="2.4" fill="var(--ink)" />
      <circle cx="47" cy="32" r="2.4" fill="var(--ink)" />
      <path d="M37 39q5 4 10 0" fill="none" stroke="var(--ink)" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="62" cy="14" r="5" fill="none" stroke="var(--accent)" strokeWidth="1.6" opacity=".7" />
      <circle cx="70" cy="26" r="3" fill="none" stroke="var(--accent)" strokeWidth="1.4" opacity=".6" />
    </svg>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Sock />
      <p className="display text-xl">{title}</p>
      {children && <p className="muted max-w-xs text-sm">{children}</p>}
    </div>
  );
}

export function Seg<T extends string | number>({
  options,
  value,
  onChange,
  label,
  fmt = String,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  fmt?: (v: T) => string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o} type="button" aria-pressed={o === value} onClick={() => onChange(o)}>
          {fmt(o)}
        </button>
      ))}
    </div>
  );
}
