# Plan: SudsQueue — Architecture & Build Plan

> **Status: DRAFT FOR REVIEW.** Nothing is built yet. Review the ADRs (section 3) and the
> "Decisions needed" list (section 11) first; everything else follows from them.

## Summary
SudsQueue is a real-time PWA that coordinates a dorm laundry room: live machine states, a fair
FIFO queue per machine type, a server-enforced 10-minute turn window, web push, and a corkboard
chat. Architecture: **one Node process** (Fastify + Socket.io) owns a **SQLite** file, runs a
**pure, clock-injected state machine** (`advance()` + commands), and serves the React PWA from
the same origin. All correctness lives on the server; phones may all be asleep.

## User Story
As a dorm resident, I want to see which machines are free, hold a fair spot in line and get
alerted when it is my turn, so that I never walk downstairs to a full laundry room or lose my
turn to someone who cut in.

## Problem → Solution
Paper sign-up sheets / a client-trusted demo (`sudsqueue.html`, Firestore read-modify-write,
client clock, no push) → a server-authoritative system with transactions, idempotent commands,
server deadlines, push to locked phones, and an audit log.

## Metadata
- **Complexity**: XL (greenfield, ~45 files) — built in 4 phases, each reviewable on its own
- **Source spec**: [`building-promt.md`](../building-promt.md) (Part 1 = spec, referenced as §N below; same content as the `.docx`)
- **Existing code**: `sudsqueue.html` (demo prototype — reuse its design tokens and SVG art only)

---

## 1. System overview

```
 iPhone / Android / Desktop (PWA)                    Single host (Fly.io), 1 instance
┌──────────────────────────────┐   HTTPS (same     ┌───────────────────────────────────────────┐
│ React + Vite + TS            │   origin)          │ Node 24 LTS process                       │
│  ├─ useServerState()  ◄──────┼── snapshot ───────┤  Fastify                                  │
│  │   (snapshot + clockOffset)│   (Socket.io)      │   ├─ static: client/dist + sw.js          │
│  ├─ command(cmd) ────────────┼── cmd+ack ───────► │   ├─ REST: /api/join-dorm, /recover,      │
│  └─ service worker (sw.js)   │                    │   │        /push/subscribe, /admin/login  │
│       push / notificationclick                    │   └─ Socket.io (auth = device token)      │
└──────────────▲───────────────┘                    │                                           │
               │ Web Push (VAPID)                   │  core/ (PURE, no I/O, clock injected)     │
   APNs / FCM ◄┴─────────────────── web-push ───────┤   ├─ advance(db, now) → Effect[]          │
                                                    │   ├─ commands.*(db, now, actor, input)    │
                                                    │   └─ duePushes(db, now) → PushIntent[]    │
                                                    │                                           │
                                                    │  runtime/                                 │
                                                    │   ├─ scheduler: setInterval 1s → advance  │
                                                    │   ├─ effects: broadcast, push, chat       │
                                                    │   └─ clock: real | demo (DEMO=1)          │
                                                    │                                           │
                                                    │  SQLite (better-sqlite3, WAL) on volume   │
                                                    └───────────────────────────────────────────┘
```

**Request lifecycle (every state change):**
`socket cmd {clientActionId, type, input}` → zod validate → idempotency lookup →
`db.transaction(() => { advance(now); command(now, actor, input); advance(now); })` →
commit → effects (broadcast snapshot, chat system messages, pushes) → `ack {ok | code}`.

**Scheduler tick (every 1s, and once on boot):** `advance(now)` in a transaction → if changed,
broadcast → `duePushes(now)` → send + record. Boot runs the same code, so a restart mid-window
loses nothing (Part 2, loophole 1).

---

## 2. Repository layout

npm workspaces monorepo. `shared/` exists so the client and server can never disagree on
commands, error codes, or the wait-time estimate.

```
laundry-room/
├─ package.json                 workspaces: shared, server, client; scripts: dev, test, build
├─ tsconfig.base.json
├─ fly.toml  Dockerfile  .env.example  README.md
├─ config/machines.json         first-boot seed only: 3 washers + 3 dryers; presets, window lengths, caps
├─ shared/src/
│  ├─ types.ts                  MachineState, Snapshot, Machine, QueueEntry, Message
│  ├─ commands.ts               zod schemas for every command + inferred types
│  ├─ errors.ts                 ErrorCode union + friendly text map
│  └─ estimate.ts               estimateWait(snapshot, now, type) — pure
├─ server/src/
│  ├─ index.ts                  boot: open db, migrate, advance(), start http+io+scheduler
│  ├─ db/
│  │  ├─ open.ts                better-sqlite3, WAL, foreign_keys, busy_timeout
│  │  └─ migrations/001_init.sql
│  ├─ core/                     ← NO sockets, NO push, NO Date.now(). 100% unit-tested.
│  │  ├─ advance.ts             the fixed-point loop (Part 3 step 4)
│  │  ├─ commands.ts            join, leave, startNow, loaded, snooze, giveUp, extend,
│  │  │                         finishEarly, collect, confirmEmpty, reportBroken, markFixed,
│  │  │                         markOccupied, notEmpty, sendMessage, reportMessage, deleteMe
│  │  ├─ admin.ts               addMachine, renameMachine, reorderMachines, retireMachine,
│  │                         restoreMachine, forceFree, removeFromQueue, mute, rotateCode, setQuiet, …
│  │  ├─ quiet.ts               isQuiet(now, tz, start, end) via Intl.DateTimeFormat
│  │  ├─ pushes.ts              duePushes(db, now) — derived, see ADR-0006
│  │  ├─ snapshot.ts            buildSnapshot(db, now)
│  │  └─ errors.ts              class CommandError(code)
│  ├─ runtime/
│  │  ├─ clock.ts               realClock | demoClock (offset, fastForward)
│  │  ├─ scheduler.ts           tick loop + effect dispatch
│  │  ├─ socket.ts              io auth, cmd handler, acks, rate limit
│  │  ├─ http.ts                Fastify routes, CSP headers, static
│  │  ├─ push.ts                web-push send, 404/410 cleanup
│  │  └─ auth.ts                token/recovery/admin hashing + verification
│  └─ test/                     advance.test.ts, commands.test.ts, quiet.test.ts, …
└─ client/
   ├─ index.html               viewport-fit=cover, theme-color (light/dark), apple meta
   ├─ public/                  manifest.webmanifest, sw.js, icons (192, 512, maskable, 180)
   └─ src/
      ├─ main.tsx  App.tsx      tabs: Laundry | Board  (desktop: Board as side panel)
      ├─ lib/socket.ts          connect, reconnect on visibility/focus/online, command()
      ├─ lib/clock.ts           offset from ping RTT; serverNow()
      ├─ lib/platform.ts        iosTab | iosInstalled | androidTab | androidInstalled | desktop
      ├─ lib/push.ts            subscribe after tap; re-register each load
      ├─ screens/               Welcome, Laundry, Board, DeviceTest, Admin
      ├─ components/            MachineCard, MachineArt (SVG), MyStatus, JoinDialog,
      │                         TurnModal, Countdown, InstallGuide, LiveDot, Mascot
      └─ styles.css             Tailwind v4 @theme tokens ported from sudsqueue.html:8-11
```

---

## 3. Architecture Decision Records (status: **proposed** — approve, change, or reject)

> Per the ADR skill these would normally live in `docs/adr/NNNN-*.md`. They are inline here so
> there is one file to review. On approval they get split into `docs/adr/` with an index.

### ADR-0001: Single Node process, single SQLite file
- **Context**: Timers, the queue-head hand-off, and "first Start-now wins" all need strict
  serialization. One dorm ≈ tens of users and < 1 write/sec.
- **Decision**: Exactly one server instance. better-sqlite3 (synchronous) in WAL mode on a
  persistent volume. Every command runs inside `db.transaction()`; because better-sqlite3 is
  synchronous and Node is single-threaded, transactions are naturally serialized — no locks
  or optimistic version checks needed for correctness.
- **Alternatives**: *Postgres + multiple instances* — needs a distributed lock/leader for the
  scheduler; overkill. *Firestore (as in the prototype)* — no server clock, client-trusted.
  *Built-in `node:sqlite`* — avoids a native build but is less battle-tested; revisit later.
- **Consequences**: + trivial correctness, zero infra. − no horizontal scaling (not needed);
  a host restart = a few seconds of downtime (acceptable; state is on disk).
- **Risk**: Fly.io `fly launch` creates **2 machines** and enables **auto-stop** by default.
  Mitigation: `fly scale count 1`, `auto_stop_machines = "off"`, `min_machines_running = 1`
  in `fly.toml`, plus a boot-time lockfile on the volume so a second process refuses to start.

### ADR-0002: Pure core with an injected clock; I/O as returned effects
- **Context**: The spec demands tests for missed turns, quiet hours, DST and restarts (§17),
  and a demo fast-forward mode (§15).
- **Decision**: `server/src/core/*` takes `(db, now: number, …)` and returns `Effect[]`
  (`{kind:'chat', text}`, `{kind:'changed'}`). It never calls `Date.now()`, sockets, or push.
  `runtime/` owns the clock and applies effects after commit.
- **Alternatives**: *Fake timers (vi.useFakeTimers)* — couples tests to setInterval
  internals. *Per-deadline setTimeout* — lost on restart, needs rescheduling on every change.
- **Consequences**: + tests use in-memory SQLite and plain numbers for time; restart = call
  `advance()`. − a 1-second polling tick (one cheap indexed query/sec — negligible).

### ADR-0003: Socket.io for commands + full snapshots; REST only for pre-auth flows
- **Context**: State is small (≤ ~20 machines, ≤ ~50 queue rows, 200 messages).
- **Decision**: After every change, broadcast the **full public snapshot** (no diffs). Commands
  go over the socket as `{clientActionId, type, input}` with an ack `{ok:true}` or
  `{ok:false, code}`. REST is used only where no device token exists yet (dorm code, register,
  recover), for push subscription, and for admin login. Snapshot includes `serverNow`.
  Chat history is sent on connect; new messages are appended via a `message` event so the
  per-change broadcast stays small.
- **Alternatives**: *Plain `ws`* — hand-roll reconnect + acks. *SSE + REST* — fine, but two
  channels for one job. *Diff/patch sync* — complexity with no payoff at this size.
- **Consequences**: + client is a pure renderer of server state; reconnect = re-render.
  − more bytes per change (≈ 5–15 KB; fine).

### ADR-0004: Identity = device token + recovery code; no accounts
- **Context**: §4 — no signup, no PII, iOS splits Safari/Home-Screen storage and may wipe it.
- **Decision**: 128-bit random token (stored in localStorage **and** IndexedDB); server keeps
  `sha256(token)` (high entropy → a fast hash is correct). Recovery code: 8 chars from a
  32-symbol unambiguous alphabet (≈ 40 bits), stored with `crypto.scrypt` + per-user salt,
  limited to 5 attempts/hour/device **and** 20/hour/name (stops device-hopping brute force).
  Admin PIN from env, scrypt-hashed at boot, compared with `crypto.timingSafeEqual`;
  5 fails → 15-min lockout (persisted in `config`). Admin login sets `devices.admin_until` (8 h).
- **Alternatives**: *Passkeys/WebAuthn* — iOS PWA storage split makes it confusing; later.
  *Email magic links* — violates "no PII". *bcrypt dependency* — `crypto.scrypt` is built in.
- **Consequences**: + zero PII. − lost token **and** lost recovery code = new identity
  (acceptable; the old one ages out).

### ADR-0005: The queue spot lives in `queue` until the machine is RUNNING
- **Context**: The spec's schema has `missed_count` on both `users` and `queue`, and no clear
  owner of a spot while RESERVED. Missed-turn, compensation and "not empty" rules all need it.
- **Decision**: A queue row has `status ∈ {waiting, reserved}`, `position_at` (sort key),
  `missed_count`, `eligible_at` (5-min re-reserve cooldown), `compensation` (bool). While
  RESERVED the row stays (status `reserved`) and `machines.owner_id` points at the user.
  - Start → delete row (counter reset is implicit).
  - Miss #1 → `status=waiting, position_at=now, missed_count=1, eligible_at=now+5m`.
  - Miss #2 → delete row, insert `blocks(user_id, type, until=now+30m)`.
  - "Not empty" / machine broke → `status=waiting, position_at = min(position_at) - 1`,
    `compensation=1`, counters untouched → front of the line.
  - Head of queue = first `ORDER BY position_at, id` among `status='waiting'` rows that are
    eligible (`eligible_at <= now`), or the first waiting row if nobody eligible remains.
  - `users.missed_count` and `users.blocked_until` are dropped (block is per type → `blocks`).
- **Alternatives**: *Remove on reserve, re-insert on miss* — loses the counter and makes
  "back to the front" restoration awkward.
- **Consequences**: + every rule in §6/§8 is a single UPDATE. + `UNIQUE(user_id, type)` enforces
  "one spot per type" in the DB itself.

### ADR-0006: Pushes are *derived from state*, not scheduled
- **Context**: §11 — de-duplicate, cancel stale pushes, skip quiet hours, survive restarts.
  A push queue with cancellation is a second state machine that can drift from the first.
- **Decision**: Each tick, `duePushes(db, now)` computes which notifications *should* exist now
  from current state (e.g. "machine M RESERVED for U and `reserved_until - now ≤ 2m`").
  Each has a dedupe key `kind:user:machine:machine.version`; send only if not in `push_log`.
  Quiet hours → `duePushes` returns nothing. A stale push is impossible: if the state changed,
  the condition is false. After quiet hours, still-true conditions fire once; expired ones
  (e.g. the 2-minute warning for a window that is gone) never fire.
  Kinds: `your_turn`, `two_min_left`, `youre_next`, `five_min_left`, `done`, `done_reminder`,
  `owner_ping_finished`, `moved_your_clothes`.
- **Alternatives**: *Push queue table with cancel-on-change* — more code, drift risk.
- **Consequences**: + no cancellation logic at all. − `duePushes` runs every second (indexed,
  cheap). Every push is visible (iOS revocation rule); 404/410 → delete subscription.

### ADR-0007: Hand-written service worker, no PWA plugin
- **Context**: Custom `push` / `notificationclick` handlers are needed anyway; caching needs
  are tiny (app shell + hashed `/assets/*`).
- **Decision**: `client/public/sw.js` (~60 lines): network-first for navigations (fallback to
  cached `/`), cache-first for `/assets/*`, never cache `/api` or `/socket.io`. The app is not
  usable offline by design (§12: no offline actions) — the cached shell just shows "Reconnecting…".
- **Alternatives**: *vite-plugin-pwa / Workbox* — a dependency and config surface for ~20
  lines of caching.
- **Consequences**: + full control, fewer deps. − the `CACHE` version string must change per
  deploy (inject the build hash at build time).

### ADR-0008: Runtime versions — Node 24 LTS, Tailwind v4, `motion`
- **Context**: The spec says Node 20, which is **end-of-life (April 2026)**. Framer Motion is
  now published as `motion` (`import { motion } from "motion/react"`). Tailwind v4 uses the
  `@tailwindcss/vite` plugin and CSS-first `@theme` config (no `tailwind.config.js`).
- **Decision**: Node 24 LTS, React 19, Vite, Tailwind v4, `motion`, Socket.io 4, Fastify 5,
  zod, web-push, better-sqlite3, Vitest. No other runtime deps: confetti, profanity list, rate
  limiting and TZ math are each < 40 lines in-house.
- **Consequences**: + supported runtime, prebuilt better-sqlite3 binaries on Windows/Linux.

---

## 4. Data model (`001_init.sql`)

All times are **INTEGER ms since epoch, UTC**. Deltas from the spec's schema are marked ★.

```sql
users(id INTEGER PK, name TEXT, name_lower TEXT UNIQUE, emoji TEXT,
      recovery_hash TEXT, recovery_salt TEXT,                          -- ★ salt
      muted_until INTEGER, created_at INTEGER, last_active INTEGER)    -- ★ missed_count/blocked_until moved (ADR-0005)
devices(token_hash TEXT PK, user_id INTEGER REFERENCES users ON DELETE CASCADE,
        push_sub TEXT, admin_until INTEGER, last_seen INTEGER)         -- ★ admin_until
machines(id TEXT PK, type TEXT CHECK(type IN('washer','dryer')), label TEXT,
         state TEXT CHECK(state IN('FREE','RESERVED','RUNNING','FINISHED','OCCUPIED_UNKNOWN','OUT_OF_ORDER')),
         owner_id INTEGER, reserved_until INTEGER, snooze_used INTEGER DEFAULT 0,          -- ★
         started_at INTEGER, ends_at INTEGER, finished_at INTEGER,
         est_min INTEGER, ext_used INTEGER DEFAULT 0, overrun_noticed INTEGER DEFAULT 0,   -- ★
         owner_pinged_at INTEGER, note TEXT, version INTEGER DEFAULT 0,                    -- ★
         sort INTEGER, retired_at INTEGER)                                                 -- ★ admin-managed machines
queue(id INTEGER PK, user_id INTEGER, type TEXT, est_min INTEGER, joined_at INTEGER,
      position_at INTEGER, status TEXT DEFAULT 'waiting', missed_count INTEGER DEFAULT 0,
      eligible_at INTEGER DEFAULT 0, compensation INTEGER DEFAULT 0,                       -- ★ ADR-0005
      UNIQUE(user_id, type))
blocks(user_id INTEGER, type TEXT, until INTEGER, PRIMARY KEY(user_id, type))              -- ★
confirmations(machine_id TEXT, user_id INTEGER, device_hash TEXT, kind TEXT,               -- ★ device, kind
              created_at INTEGER, PRIMARY KEY(machine_id, user_id, kind))
messages(id INTEGER PK, user_id INTEGER, kind TEXT CHECK(kind IN('normal','announcement','system')),
         text TEXT CHECK(length(text) <= 280), pinned_until INTEGER, deleted INTEGER DEFAULT 0,
         reports INTEGER DEFAULT 0, created_at INTEGER)
events(id INTEGER PK, at INTEGER, user_id INTEGER, machine_id TEXT, action TEXT, detail TEXT)
actions(client_action_id TEXT PK, user_id INTEGER, result TEXT, at INTEGER)  -- ★ idempotency (TTL 1h)
push_log(key TEXT PK, at INTEGER)                                            -- ★ ADR-0006 (TTL 24h)
config(key TEXT PK, value TEXT)  -- dorm_code_hash, quiet_start, quiet_end, tz, links_allowed, admin_lock_until, …
CREATE INDEX events_at ON events(at);
CREATE INDEX queue_head ON queue(type, status, position_at);
```

Machines are **owned by the database**, not the config file. `config/machines.json` seeds
3 washers + 3 dryers only when the `machines` table is empty. After that, admins add, rename,
reorder and retire machines from the Admin screen. Ids are generated (`w4`, `d4`, …). Retiring
sets `retired_at` and is allowed only when the machine is FREE or OUT_OF_ORDER. Retired machines
drop out of the snapshot and the queue, but they keep their audit history and can be restored.
Each change bumps the snapshot and posts a system chat message. The join rate limit (5/h) is `COUNT(*) FROM events WHERE action='join'`
in the last hour, so it survives restarts without another table.

---

## 5. State machine

```
             reportBroken / admin                        markFixed / admin
   ┌───────────────────────────────────►  OUT_OF_ORDER ─────────────────► FREE
   │
 FREE ──(queue head, not quiet)──► RESERVED ──loaded──► RUNNING ──now ≥ ends_at──► FINISHED
  ▲ │                               │  ▲                  │  +5/+10 (cap 240 min)      │
  │ │ startNow (queue empty) ───────┼──┼─────────────────►│  finishEarly ─────────────►│
  │ │                               │  └ snooze +5 (once) │                            │
  │ └─markOccupied──► OCCUPIED_UNKNOWN ◄──notEmpty (user → front, no penalty)          │
  │                     │ 2 confirmations / admin                                      │
  ├─────────────────────┘                                                              │
  │◄── giveUp / window expiry (miss rules, ADR-0005) ── RESERVED                       │
  └──── collect (owner) │ 2 confirmations after owner ping + 5 min │ admin forceFree ──┘
```

`advance(db, now)` — loop until nothing changes (assert < 50 iterations):
1. RUNNING ∧ now ≥ ends_at → FINISHED (`finished_at = ends_at`), chat effect.
   RUNNING ∧ now > started_at + est + 15m ∧ !overrun_noticed → chat notice.
2. RESERVED ∧ now ≥ reserved_until → miss rules → FREE, chat effect.
3. FINISHED ∧ queue(type) non-empty ∧ now ≥ finished_at + 10m ∧ !owner_pinged_at → set
   `owner_pinged_at` (drives the `owner_ping_finished` push; confirmations unlock 5 min later).
4. OCCUPIED_UNKNOWN ∧ 2 valid confirmations → FREE. FINISHED ∧ unlocked ∧ 2 valid
   confirmations → FREE + `moved_your_clothes` + event.
5. FREE ∧ !quiet ∧ eligible head exists → RESERVED (`reserved_until = now + 10m`).
6. Housekeeping, at most once per minute: expire confirmations > 10 min and announcements
   > 24 h; prune messages (keep 200 / 48 h), events (30 d), actions (1 h), push_log (24 h).

Every mutation bumps `machines.version` (used in push dedupe keys).

---

## 6. Protocol

```ts
// client → server
socket.emit('cmd', { clientActionId: uuid, type: 'join', input: { type: 'washer', estMin: 45 } }, ack)
// ack
{ ok: true } | { ok: false, code: ErrorCode, retryAfterMs?: number }
// server → client
'snapshot' : { serverNow, me: {id, name, emoji, isAdmin}, machines[], queues: {washer[], dryer[]},
               pinned[], quiet: {active, endsAt}, config: {presets, windowMin} }
'message'  : Message
'time'     : { serverNow }   // reply to 'ping'
```

`ErrorCode` = `NOT_YOUR_TURN | ALREADY_CLAIMED | ALREADY_IN_QUEUE | QUEUE_BLOCKED | RATE_LIMITED
| INVALID_STATE | INVALID_INPUT | NAME_TAKEN | BAD_CODE | MUTED | LINKS_BLOCKED | NOT_ADMIN
| LOCKED_OUT | CAP_REACHED | DUPLICATE_CONFIRMATION`. The client maps each to friendly text
via `shared/errors.ts`.

- **Socket auth**: `io({ auth: { token } })`; the server hashes it and looks up `devices`.
  Unknown token → `connect_error('AUTH')` → the client shows Welcome.
- **Rate limit**: per-socket token bucket, 10 commands / 5 s; chat 1 msg / 2 s per user.
- **Clock offset**: the client sends `ping` 3× on connect and keeps the lowest-RTT sample:
  `offset = serverNow + rtt/2 - Date.now()`. Countdowns render from `Date.now() + offset`
  against server timestamps. While disconnected, timers are greyed and buttons disabled.

---

## 7. UX

> Full visual and interaction design: **[ui-ux-design-plan.md](ui-ux-design-plan.md)**. That file
> replaces the visual notes in this section. Where they differ (fonts, colours), it wins.

### Before
```
┌───────────────────────────────┐
│ Paper sheet on the door /     │
│ prototype: timers on YOUR     │
│ phone clock, no alerts when   │
│ locked, anyone can cut in     │
└───────────────────────────────┘
```
### After
```
┌───────────────────────────────┐   ┌─────────── TURN MODAL ─────────┐
│ ● Live            🧦 SudsQueue │   │  🎉 It's your turn!  9:41       │
│ ┌ My Status ────────────────┐ │   │  Washer 2 is reserved for you  │
│ │ Washers: #2 · ~18 min      │ │   │ [ I've loaded it, start! ]     │
│ │ Dryers:  not in line [Join]│ │   │ [ +5 min (once) ] [ Give up ]  │
│ └───────────────────────────┘ │   │ [ The machine isn't empty ]    │
│ WASHERS                        │   └────────────────────────────────┘
│ [🫧 W1 Running 12m · 21:40]    │
│ [⏳ W2 Reserved Sam 6:12]      │
│ [✅ W3 Free  ⟶ Start now]      │
│ Queue: 1 Ana 🦊 · 2 You 🐸     │
│ ─────────────────────────────  │
│ [ Laundry ]   [ Board • 3 ]    │
└───────────────────────────────┘
```

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| First visit | none | Dorm code → name + emoji → recovery code shown once → platform-specific install/alerts guide | Permission asked only on tap |
| Your turn | toast if tab open | Push (locked phone) + full-screen modal, confetti, sound, vibration, flashing title | 2-min reminder push |
| Walk-up | not modelled | "Someone is using this" → OCCUPIED_UNKNOWN | 2 confirmations to clear |
| Disconnect | silent stale timers | "Reconnecting…", greyed timers, disabled buttons | full refetch on visible/focus/online |

Visual design: port the colour tokens from `sudsqueue.html:8-11` into Tailwind `@theme`; port the
machine SVG from `sudsqueue.html:124-132` into `MachineArt.tsx` (add the OCCUPIED_UNKNOWN "?" tag
and rename `broken` → OUT_OF_ORDER). Fredoka display font. Every state = colour + icon + text.
`prefers-reduced-motion` disables spin, bubbles and confetti.

---

## 8. Mandatory reading

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | `building-promt.md` | 35-65 | Exact queue/turn/finish/quiet rules — the tests encode these |
| P0 | this plan | §3–6 | ADR deltas vs. the spec's schema |
| P1 | `sudsqueue.html` | 8-11 | Colour tokens (light/dark) |
| P1 | `sudsqueue.html` | 105-113 | Prototype `tick()` — same fixed-point idea as `advance()`, **but client-side; do not copy its Firestore read-modify-write** |
| P2 | `sudsqueue.html` | 124-134 | SVG machine art + state labels to port |

## External documentation

| Topic | Source | Key takeaway |
|---|---|---|
| iOS web push | webkit.org, "Web Push for Web Apps on iOS and iPadOS" | Home-Screen install only (16.4+); permission from a user gesture inside the installed app; every push must show a notification |
| web-push (npm) | github.com/web-push-libs/web-push | `setVapidDetails('mailto:…', pub, priv)`; `statusCode` 404/410 → delete subscription |
| better-sqlite3 | github.com/WiseLibs/better-sqlite3 `docs/api.md` | `db.transaction(fn).immediate()`; `pragma('journal_mode = WAL')` |
| Socket.io v4 | socket.io/docs/v4 | `auth` handshake option; acks via callback; no need for `connectionStateRecovery` (we resend the snapshot) |
| Fly.io | fly.io/docs/reference/configuration | Volumes are single-machine; set `auto_stop_machines = "off"`, `min_machines_running = 1` |
| Tailwind v4 | tailwindcss.com/docs/installation/using-vite | `@tailwindcss/vite` plugin, `@import "tailwindcss"`, `@theme {}` |

Gotchas (from prior knowledge, to re-verify at implementation time):
- iOS has no `beforeinstallprompt` → show the illustrated Share-sheet guide instead.
- iOS audio needs a gesture; keep one unlocked `AudioContext` after "Tap to enable sounds".
- Android Back button: push a history entry when a modal/chat opens; `popstate` closes it.
- CSP: `default-src 'self'; connect-src 'self' wss:; img-src 'self' data:; style-src 'self' 'unsafe-inline'`.
  Self-hosting Fredoka keeps the CSP to `'self'` and avoids a third-party request (EU privacy).

---

## 9. Implementation phases & tasks

Phases follow the spec's own advice (Part 3, "Shortcut"). **Stop for review after each phase.**

### Phase A — Core (spec steps 3–6). No UI, no network.
1. **Scaffold workspaces** — root `package.json` workspaces, strict `tsconfig.base.json`,
   Vitest in `server`. VALIDATE: `npm test` runs.
2. **Migration + `db/open.ts`** — schema §4; WAL, `foreign_keys=ON`, `busy_timeout=5000`.
   VALIDATE: test opens `:memory:`, migrates, lists tables.
3. **`shared/`** — types, zod command schemas, ErrorCode. GOTCHA: names trimmed, 2–20 chars,
   uniqueness via `name_lower`; `estMin` integer 15–180.
4. **`core/quiet.ts`** — `isQuiet(now, tz, '00:00', '07:00')` using
   `Intl.DateTimeFormat('en-GB', {timeZone, hour:'2-digit', minute:'2-digit', hourCycle:'h23'})`;
   handles windows that wrap midnight. VALIDATE: tests across DST in `Europe/Berlin` and
   `America/New_York`.
5. **`core/advance.ts`** — §5 steps 1–6. GOTCHA: loop to a fixed point; a machine finishing
   its window and the next head being reserved must happen in the *same* call.
6. **`core/commands.ts`** — one function per action: assert actor/state → mutate → write
   `events` → return effects. `startNow` on FREE with an empty queue: first wins, second gets
   `ALREADY_CLAIMED`. GOTCHA: with a non-empty queue `startNow` is refused for everyone
   (except during quiet hours, §9); the head is auto-reserved by `advance`.
7. **`core/pushes.ts` + `snapshot.ts`** — ADR-0006 rules; `estimateWait` in `shared/`.
8. **`runtime/clock.ts` + `scheduler.ts`** — `advance` on boot + every 1 s inside
   `db.transaction(...).immediate()`; effects dispatched after commit.
   **Phase A gate:** all tests in §10 pass.

### Phase B — Realtime + push (spec steps 7–8)
9. **`runtime/auth.ts` + `http.ts`** — `/api/join-dorm` (code check, 10/h/IP), `/api/register`,
   `/api/recover`, `/api/push/subscribe`, `/api/admin/login`, `DELETE /api/me` ("Delete my
   data"). Security headers + CSP. Serves `client/dist`.
10. **`runtime/socket.ts`** — auth handshake, `cmd` handler with idempotency via `actions`
    (same `clientActionId` → replay the stored result), token bucket, `ping` → `time`.
11. **`runtime/push.ts`** — VAPID; payload `{title, body, tag, url}`; `tag` = dedupe key so the
    OS also collapses duplicates. VALIDATE: test with a fake sender; manual test on Android.

### Phase C — Client (spec steps 9–11)
12. **PWA shell** — manifest, icons, `sw.js` (ADR-0007), `index.html` meta tags.
13. **`lib/`** — socket (reconnect on `visibilitychange` / `focus` / `online`), clock offset,
    platform detection (`navigator.standalone`, `matchMedia('(display-mode: standalone)')`),
    push subscribe-after-tap + re-register on load, token in localStorage + IndexedDB.
14. **Screens, in order** — Welcome → Laundry (MyStatus, MachineCard + MachineArt, queues) →
    JoinDialog → TurnModal → Board (corkboard, plain-text rendering, VisualViewport keyboard
    handling, unread badge) → InstallGuide → DeviceTest.
    GOTCHA: inputs ≥ 16 px, tap targets ≥ 44 px, `100dvh`, `env(safe-area-inset-*)`.

### Phase D — Admin, demo, deploy (spec steps 12, 14)
15. **Admin screen + `core/admin.ts`** — all §15 actions; paged audit-log view.
16. **Demo mode** — `DEMO=1` → `demoClock` with admin-only `POST /api/demo/forward {minutes}`
    and a "DEMO" banner on every client.
17. **Deploy** — multi-stage Dockerfile (`node:24-slim`), `fly.toml` (ADR-0001 risk), volume at
    `/data`, daily `VACUUM INTO '/data/backup-YYYYMMDD.db'` (keep 7) + Fly volume snapshots.
    README: setup, env vars, HTTPS, resident install steps, assumptions, EU note.

---

## 10. Testing strategy

Unit tests use `:memory:` SQLite and numeric `now`. Helpers: `world({washers: 2, dryers: 1})`,
`at(minutes)`.

| Test | Setup → action | Expected |
|---|---|---|
| Auto-reserve | W1 FREE, Ana joins | W1 RESERVED for Ana, until = now + 10 m |
| Miss #1 | Ana reserved, Ben waiting, advance(+10 m) | Ana at back, missed = 1; W1 RESERVED for Ben; chat msg |
| Lone miss | Ana alone, advance(+10 m) | W1 re-reserved for Ana (nobody else waiting), missed = 1 |
| Cooldown | Ana missed at +10 m, Ben joins at +12 m, W1 frees | Ben reserved before Ana until +15 m |
| Miss #2 | Ana misses twice in a row | Ana removed; join → QUEUE_BLOCKED until +30 m |
| Start resets | Ana misses once, then loads | queue row gone; next miss counts from 0 |
| Simultaneous start | W1 FREE, empty queue, two `startNow` | first ok, second ALREADY_CLAIMED |
| Walk-up can't cut | queue non-empty, outsider `startNow` | INVALID_STATE |
| Idempotency | same clientActionId twice | one join event, identical ack |
| Snooze once | snooze, snooze | +5 m, then INVALID_STATE |
| Not empty | Ana reserved, `notEmpty` | W1 OCCUPIED_UNKNOWN; Ana at front, missed unchanged |
| Broken mid-cycle | Ana RUNNING, reportBroken | OUT_OF_ORDER; Ana at front + compensation |
| Finish → FINISHED | RUNNING, advance(ends_at) | FINISHED, not FREE; `done` push due |
| Forgotten laundry | FINISHED + 10 m, queue non-empty | owner pinged; confirmations rejected until + 15 m; 2 users → FREE |
| Same-user double confirm | one user, two devices | DUPLICATE_CONFIRMATION |
| Confirmation expiry | confirm, +11 m, confirm by another user | still needs 2 |
| Extension cap | extend past 240 total | CAP_REACHED |
| Overrun notice | RUNNING past est + 15 m | one chat notice |
| Quiet hours | machine frees at 00:30 | stays FREE; no pushes; at 07:00 head reserved |
| Window across quiet start | reserved 23:55 | expires normally at 00:05; `two_min_left` suppressed |
| DST | quiet 00:00–07:00 Europe/Berlin over the last Sunday of October | boundaries at local 00:00/07:00 on both days |
| Restart | reserved, close db, reopen at +12 m, advance | same result as without restart |
| Push dedupe | 5 ticks inside the 2-min window | exactly one `two_min_left` |
| Stale push | Ana is "next", then gets the machine | no `youre_next` after reservation |
| Rate limits | 6 joins/hour; 2 messages in 1 s | RATE_LIMITED |
| Chat safety | `<img onerror=…>` text; a link while links are blocked | stored as text, rendered as text; LINKS_BLOCKED |

Edge cases: empty queue, all machines OUT_OF_ORDER, machine removed from config while busy,
names differing only by case, recovery brute force, admin lockout.

### Validation commands
```bash
npm run typecheck        # tsc -b across workspaces — EXPECT 0 errors
npm test                 # vitest run — EXPECT all pass (Phase A gate)
npm run build            # vite build + server tsc
npm run dev              # server :3000 + vite :5173 (proxies /api and /socket.io)
DEMO=1 npm run dev       # fast-forward testing
```
Manual (spec Part 3 step 13): iPhone Safari tab + installed, Android Chrome tab + installed —
join, lock phone, receive push, start, miss on purpose, report broken, chat with the keyboard,
landscape, dark mode, Wi-Fi off/on, two phones claiming at once.

---

## 11. Decisions needed from you

1. **Hosting**: Fly.io is assumed (volume + always-on single machine). OK, or Render / Railway?
2. **Time zone**: what is the dorm's time zone? Machines are settled: 3 washers + 3 dryers to start, and admins add more in the app.
3. **Node 24 instead of the spec's Node 20** (Node 20 is EOL) — OK?
4. **Fonts and visual direction**: see the decisions D1–D4 in `ui-ux-design-plan.md`. Fonts are self-hosted either way.
5. **Single shared admin PIN** (as the spec says), not per-admin accounts — OK?
6. **ADR files**: on approval, split section 3 into `docs/adr/0001…0008.md` + an index?

## NOT building
- Multiple dorms / multi-tenancy, horizontal scaling, Postgres.
- Native apps, passkeys, email/SMS, real names.
- Offline action queueing (explicitly forbidden, §12).
- Hardware integration (smart plugs / sensors) — walk-ups stay a social problem (Part 2, last item).
- Analytics, i18n (English only for v1), message editing, DMs, image upload.

## Risks
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Fly runs 2 instances or auto-stops | High (defaults) | Double reservations / no timers | ADR-0001 `fly.toml` + lockfile |
| iOS users never install to Home Screen → no push | High | Missed turns | Honest banner, in-app alerts, poster with install steps, 10-min window |
| APNs/FCM delivery delays | Medium | Late "your turn" | 10-min window + 2-min reminder + "you're next" heads-up |
| iOS storage wipe → identity lost | Medium | Duplicate users | Recovery code restores the same user |
| Fake confirmations | Low–Med | Clothes moved | 2 users on 2 devices, owner pinged first, audit log, admin mute |
| better-sqlite3 native build fails on the Windows dev box | Low | Setup friction | Node 24 prebuilds; fallback `node:sqlite` |

## Acceptance criteria
- [ ] Phase A tests (§10) all pass before any network code exists
- [ ] Every command validated server-side; the client never sends identity or time
- [ ] Restart mid-window produces the same state as no restart
- [ ] Push works on Android (tab + installed) and iOS (installed); in-app fallback everywhere else
- [ ] No type errors; `npm run build` succeeds; README covers setup, deploy, install, assumptions
