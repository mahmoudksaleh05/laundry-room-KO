export type Mode = 'ios-tab' | 'ios-installed' | 'android-tab' | 'android-installed' | 'desktop';

const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);
export const isStandalone = () =>
  matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export function mode(): Mode {
  const s = isStandalone();
  if (isIOS) return s ? 'ios-installed' : 'ios-tab';
  if (isAndroid) return s ? 'android-installed' : 'android-tab';
  return 'desktop';
}

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

/** Android/desktop Chrome install prompt, captured once. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
}
let deferred: InstallPrompt | null = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  listeners.forEach((l) => l());
});
export const canPromptInstall = () => !!deferred;
export const onInstallChange = (l: () => void) => (listeners.add(l), () => listeners.delete(l));
export async function promptInstall() {
  if (!deferred) return;
  await deferred.prompt();
  deferred = null;
  listeners.forEach((l) => l());
}
