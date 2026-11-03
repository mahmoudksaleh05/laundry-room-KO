# SudsQueue 🫧

A web app (PWA) for a shared dorm laundry room. Residents join a line for a washer or dryer, get an alert when one is held for them, and see every machine live. It has a board for notes and admin tools for adding, renaming and retiring machines.

- Design: [docs/ui-ux-design-plan.md](docs/ui-ux-design-plan.md) ("Linen & Tide")
- Architecture and decisions: [docs/architecture-plan.md](docs/architecture-plan.md)

## Stack

| Part | What |
|---|---|
| `shared/` | Types, zod command schemas, error text, the wait estimate |
| `server/` | Node 24, Fastify 5, Socket.io 4, better-sqlite3 (WAL), web-push. Business rules live in `server/src/core` as pure functions with an injected clock |
| `client/` | React 19, Vite 7, Tailwind 4, motion. A hand-written service worker in `client/public/sw.js` |
| `config/machines.json` | Seeds the machines (3 washers, 3 dryers) and default timings, **on first boot only**. After that, machines live in the DB and admins manage them in the app |

## Run it locally

```bash
npm install
```

npm 11 blocks install scripts by default. If `better-sqlite3` fails to load, run `npm approve-scripts better-sqlite3 esbuild && npm rebuild`.

```bash
npm run dev
```

Open http://localhost:5173. The dorm code is `SUDS` and the admin PIN is `0000`. These dev defaults are refused in production.

To try timers without waiting, start with `DEMO=1 npm run dev`. Then go to Menu → Enter PIN → Admin tools → **Demo** and move the clock forward.

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run icons
```

`npm test` runs 36 tests on the queue engine: reservations, misses, quiet hours, DST, confirmations and pushes. `npm run icons` regenerates the PNG icons with no dependencies.

## Environment

See [.env.example](.env.example). The server reads real environment variables; there is no dotenv. Production (`NODE_ENV=production`) requires:

| Var | Purpose |
|---|---|
| `DORM_CODE` | Residents type it once to sign up. Admins can change it in the app |
| `ADMIN_PIN` | Turns on admin mode on one device for 8 hours. Use 6 or more digits |
| `VAPID_SUBJECT` | `mailto:` contact for push services |
| `TZ_NAME` | Dorm time zone for quiet hours, e.g. `Europe/Berlin`. Defaults to `UTC` |

If `VAPID_PUBLIC` and `VAPID_PRIVATE` are not set, keys are generated on first boot and stored in the DB. Keep the volume, or every device has to turn alerts on again.

## Deploy (Fly.io)

Run as one always-on machine with a 1 GB volume. SQLite allows one writer, and timers and pushes run inside the process, so never scale to two machines.

```bash
fly launch --no-deploy --copy-config
```

```bash
fly volumes create suds_data --size 1
```

```bash
fly secrets set DORM_CODE=… ADMIN_PIN=… VAPID_SUBJECT=mailto:you@example.com
```

```bash
fly deploy
```

HTTPS is required: service workers and push only work on `https://` or `localhost`. Fly provides HTTPS. A daily `VACUUM INTO` backup goes to `/data/backups`, and the last 7 are kept.

## Telling residents how to install it

- **iPhone (iOS 16.4+):** open the link in Safari → Share → **Add to Home Screen** → open SudsQueue from the Home Screen → Menu → Alerts → Turn on. iOS only allows alerts for installed web apps.
- **Android:** open in Chrome → **Install app** (or ⋮ → Add to Home screen) → allow notifications when asked.
- **Everyone:** Menu → **Test this device** checks the connection, sound, vibration and a real push.

## How the line works

- When a machine frees up, the next person gets it **held for 10 minutes** (admins can change this), with one 5-minute snooze.
- If you miss your turn, you go to the back of the line with a 5-minute cooldown. Missing twice drops you from the line and pauses joining for 30 minutes.
- "It's not empty" or "Out of order" puts the person it was held for at the front of the line.
- Forgotten laundry: the owner is reminded 10 minutes after the cycle ends, and 5 minutes after that **two different people on two different devices** can confirm the clothes were moved out.
- During quiet hours (00:00–07:00 by default) the line pauses and no alerts are sent. Free machines are first come, first served.

## Assumptions

- One dorm per deployment, with a few dozen residents.
- Residents are identified by a device token. The recovery code (shown once) restores an account on a new device. Nothing else is collected.
- Machines are not connected to the app. Residents report what they do, and the two-person confirmations cover the rest.

## Privacy (EU/GDPR notes)

The app stores a chosen display name and symbol, laundry activity and board notes. It sets no tracking and loads no third-party requests; fonts are self-hosted. Board notes are deleted after 48 hours, the activity log after 30 days, and accounts inactive for 60 days are removed. Menu → **Delete my data** removes an account immediately. Whoever runs the instance is the data controller and should post a short notice in the laundry room.
