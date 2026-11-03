import '@fontsource-variable/fraunces/soft.css';
import '@fontsource-variable/manrope';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { boot } from './lib/store';
import { prefs } from './lib/storage';

const theme = prefs.get<'system' | 'light' | 'dark'>('theme', 'system');
if (theme !== 'system') document.documentElement.dataset.theme = theme;

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`/sw.js?v=${__BUILD__}`).catch(() => {});
}

void boot();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
