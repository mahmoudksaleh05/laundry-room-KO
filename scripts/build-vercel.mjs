// Builds the Vercel output: the client as static files, the API as one Node function.
// https://vercel.com/docs/build-output-api/v3
import { build } from 'esbuild';
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });

execSync('npm run build -w client', { stdio: 'inherit' });
cpSync('client/dist', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['server/src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // Some bundled CommonJS deps call require() for Node built-ins.
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: 'info',
});
writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, maxDuration: 15 }),
);

const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
  "manifest-src 'self'",
  "worker-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join('; ');

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        {
          src: '/(.*)',
          headers: { 'Content-Security-Policy': csp, 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' },
          continue: true,
        },
        { src: '/sw.js', headers: { 'Cache-Control': 'no-cache' }, continue: true },
        { src: '/assets/(.*)', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '/api/(.*)', dest: '/api' },
        { src: '/(.*)', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Vercel output ready in ${out}`);
