import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BUILD = Date.now().toString(36);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __BUILD__: JSON.stringify(BUILD) },
  server: {
    port: 5173,
    // LAN=1 lets phones on the same Wi-Fi open the dev server.
    host: process.env.LAN === '1',
    proxy: { '/api': 'http://localhost:3000' },
  },
  build: { target: 'es2022', sourcemap: false },
});
