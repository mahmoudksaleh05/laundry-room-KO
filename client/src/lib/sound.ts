import { prefs } from './storage';

let ctx: AudioContext | null = null;

export const soundsOn = () => prefs.get('sounds', true) && ctx?.state === 'running';

/** Browsers only allow audio after a tap; call this from one. */
export async function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state !== 'running') await ctx.resume();
  prefs.set('sounds', true);
}

export const audioState = () => (ctx?.state === 'running' ? 'on' : 'locked');

/** A soft two-note chime, synthesised (no audio files). */
export function chime() {
  if (!soundsOn() || !ctx) return;
  const t = ctx.currentTime;
  [659.25, 987.77].forEach((f, i) => {
    const o = ctx!.createOscillator();
    const g = ctx!.createGain();
    o.type = 'sine';
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t + i * 0.18);
    g.gain.linearRampToValueAtTime(0.18, t + i * 0.18 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 1.2);
    o.connect(g).connect(ctx!.destination);
    o.start(t + i * 0.18);
    o.stop(t + i * 0.18 + 1.3);
  });
}

export const vibrate = (p: number[]) => 'vibrate' in navigator && navigator.vibrate(p);
