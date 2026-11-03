# SudsQueue 🫧

A web app (PWA) for a shared dorm laundry room. Residents join a line for a washer or dryer, get an alert when one is held for them, and see every machine live. It has a board for notes and admin tools for adding, renaming and retiring machines.

- Design: [docs/ui-ux-design-plan.md](docs/ui-ux-design-plan.md) ("Linen & Tide")
- Architecture and decisions: [docs/architecture-plan.md](docs/architecture-plan.md)

## Stack

| Part | What |
|---|---|
| `shared/` | Types, zod command schemas, error text, the wait estimate |
| `server/` | Fastify 5 API, `node:sqlite`, web-push. Business rules live in `server/src/core` as pure functions with an injected clock |
| `client/` | React 19, Vite 7, Tailwind 4, motion, Supabase Realtime. A hand-written service worker in `client/public/sw.js` |
| `config/machines.json` | Seeds the machines (3 washers, 3 dryers) and default timings, **on first run only**. After that, admins manage machines in the app |

**How it runs on Vercel.** The API is one Vercel function (`server/src/vercel.ts`). The dorm's whole database is a small SQLite file kept as one locked row in Supabase Postgres (`laundry.store`): each request loads it, runs the same tested rules, and saves it back. After every change the API writes the public board to `laundry.state`, and phones get it instantly through Supabase Realtime. A Supabase cron job calls `/api/tick` every minute so held machines expire and alerts go out even when nobody has the app open. Phones also nudge `/api/tick` the moment a timer hits zero.

## Run it locally

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Log in with any name and a room number such as `304`. The admin PIN is `0000`. Without `DATABASE_URL` the API uses a local SQLite file and the app polls every 3 seconds instead of using Realtime.

To try timers without waiting, start with `DEMO=1 npm run dev`. Then go to Menu → Enter PIN → Admin tools → **Demo** and move the clock forward.

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run vercel-build
```

`npm test` runs 37 tests on the queue engine and login rules. `npm run vercel-build` produces the exact output Vercel deploys, in `.vercel/output`.

## Environment

See [.env.example](.env.example). Production (`NODE_ENV=production`, which Vercel sets) requires `DATABASE_URL`, `ADMIN_PIN`, `CRON_SECRET` and `VAPID_SUBJECT`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` for live updates.

If `VAPID_PUBLIC` and `VAPID_PRIVATE` are not set, keys are generated on first run and stored in the database.

## Deploy (Vercel + Supabase, both free)

1. **Supabase.** In a project, open the SQL editor and run [supabase/laundry.sql](supabase/laundry.sql). First replace `YOUR-APP.vercel.app` and `YOUR-CRON-SECRET` at the bottom (you can rerun it after step 3 once you know the URL). It only creates a `laundry` schema, so it can share a project with other apps.
2. **Vercel.** Import the GitHub repo (Framework preset: Other). `vercel.json` already sets the build command. Add the environment variables from `.env.example`. For `DATABASE_URL` use Supabase → **Connect** → *Transaction pooler* URI.
3. Deploy, then rerun the cron part of `laundry.sql` with your real `https://….vercel.app` URL and secret.
4. Open the site, log in, and test Menu → **Test this device**.

HTTPS is required for install and alerts, and Vercel provides it. A daily copy of the database is kept in `laundry.backups` (last 7 days).

## Telling residents how to install it

- **iPhone (iOS 16.4+):** open the link in Safari → Share → **Add to Home Screen** → open SudsQueue from the Home Screen → Menu → Alerts → Turn on. iOS only allows alerts for installed web apps.
- **Android:** open in Chrome → tap **Install the app** (or ⋮ → Install app) → allow notifications when asked.
- **Everyone:** Menu → **Test this device** checks the connection, sound, vibration and a real push.

## How the line works

- Open 24/7. There are no quiet hours.
- When you join a line or start a free machine you choose **30, 60 or 90 minutes**, or a custom length up to **90 minutes**.
- A running cycle can be extended **twice, by 15 minutes each**.
- When a machine frees up, the next person gets it **held for 10 minutes**, with one 5-minute snooze.
- If you miss your turn, you go to the back of the line with a 5-minute cooldown. Missing twice drops you from the line and pauses joining for 30 minutes.
- "It's not empty" or "Out of order" puts the person it was held for at the front of the line.
- Forgotten laundry: the owner is reminded 10 minutes after the cycle ends, and 5 minutes after that **two different people on two different devices** can confirm the clothes were moved out.
- All times are shown in Budapest time (24-hour), synced to the server clock.

## Logging in

- You log in with **your name and your 3-digit room number**. The first digit is the floor (1–8), so rooms run 100–899.
- At most **2 people per room**. Names are unique within a room, not case-sensitive.
- The first time, you also pick a symbol. After that, the same name and room log you in on any device.
- There is no password. Anyone who knows your name and room can log in as you. That is fine for a laundry line, but don't reuse this for anything sensitive.

## Assumptions

- One dorm per deployment, with up to a few hundred residents.
- Machines are not connected to the app. Residents report what they do, and the two-person confirmations cover the rest.

## Privacy (EU/GDPR notes)

The app stores a display name, room number and symbol, laundry activity and board notes. Data is held in your Supabase project (pick an EU region) and the app runs on Vercel. The public board (names, rooms, machines, notes) can be read with the site's public Supabase key, so treat it as visible to anyone who has the link. Board notes are deleted after 48 hours, the activity log after 30 days, and accounts inactive for 60 days are removed. Menu → **Delete my data** removes an account immediately. Whoever runs the instance is the data controller and should post a short notice in the laundry room.
