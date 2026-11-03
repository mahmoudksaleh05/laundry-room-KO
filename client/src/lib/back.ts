import { useEffect, useRef } from 'react';

/**
 * Android Back / swipe-back closes the top-most overlay first.
 * Each open overlay owns one history entry; closing it in the UI pops that entry.
 */
const stack: { close: () => void }[] = [];
let ignorePops = 0;

window.addEventListener('popstate', () => {
  if (ignorePops > 0) {
    ignorePops--;
    return;
  }
  stack.pop()?.close();
});

export function useBackClose(open: boolean, close: () => void) {
  const ref = useRef(close);
  ref.current = close;
  useEffect(() => {
    if (!open) return;
    const entry = { close: () => ref.current() };
    stack.push(entry);
    history.pushState({ suds: stack.length }, '');
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) {
        // Closed by the UI, not by Back: remove our history entry quietly.
        stack.splice(i, 1);
        ignorePops++;
        history.back();
      }
    };
  }, [open]);
}
