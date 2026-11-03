SudsQueue: Build Prompt, Loophole Review and Implementation Guide
Version 2, for a real backend build (iPhone and Android)
How to use this document
Part 1 is the final merged prompt. Give it to a developer or to an AI coding tool such as Claude Code. Part 2 lists the extra loopholes I found while merging, and where Part 1 already fixes each one. Part 3 is a step-by-step guide for building and launching the app.
The prototype I published earlier is a demo only. It has no server clock and no push notifications. Everything below assumes a real server.
Part 1: The build prompt
1. Goal and principles
Build SudsQueue, a real-time, installable web app (PWA) that coordinates the washing machines and dryers in a dorm laundry room. It shows which machines are free, runs a fair queue, gives each person a 10-minute window when it is their turn, and has a shared chat. It must work on iPhone (Safari 16.4+, in a tab and installed to the Home Screen), Android (Chrome and Samsung Internet, in a tab and installed), and desktop browsers.
Principles:
•	The server is the single source of truth. Never trust a client clock or client-sent identity.
•	Every state change is a server-side transaction and is idempotent (safe if a button is tapped twice or a request is retried).
•	Phones sleep. The system must be correct even if every phone is locked. Never depend on a client being awake.
•	If alerts are impossible for a user, say so honestly and fall back to in-app alerts.
2. Tech stack
•	Frontend: React + Vite + TypeScript, Tailwind CSS, Framer Motion. PWA with manifest, service worker, icons (192, 512, 180x180 apple-touch-icon, maskable).
•	Backend: Node.js 20, Fastify (or Express), Socket.io for real-time updates, web-push for push notifications.
•	Database: SQLite via better-sqlite3 in WAL mode on a persistent disk. Run exactly ONE server instance (this keeps timers and transactions simple). Use Postgres only if you later need more than one instance.
•	Tests: Vitest. The state machine must take an injectable clock so time can be faked.
•	Hosting: any host with HTTPS and a persistent volume (Fly.io, Render, Railway). HTTPS is required for service workers and push.
3. Machines and states
Machines come from a config file (id, type = washer or dryer, label). Each machine is always in exactly one state:
1.	FREE: empty and available.
2.	RESERVED: it is someone’s turn. Shows their name and a 10:00 countdown.
3.	RUNNING: shows the owner, start time, remaining time, and “ready at HH:MM”.
4.	FINISHED: the cycle ended and clothes may still be inside. Shows how long it has been waiting.
5.	OCCUPIED_UNKNOWN: someone is using it without the app (a walk-up). No owner. See section 8.
6.	OUT_OF_ORDER: reported broken. Excluded from the queue until fixed.
Every state has its own color, icon, text label, and animation.
4. Identity and access
•	No signup. First visit: enter the dorm access code (rate limited, rotatable by admin), choose a display name (2–20 characters, trimmed, unique among active users, case-insensitive) and an avatar emoji.
•	Each device gets a random 128-bit token stored in localStorage AND IndexedDB. The server stores only a hash of it.
•	Recovery code: generate an 8-character random code (not a 4-digit PIN, which can be guessed) shown once. Store only its hash. “I already have an account” = name + recovery code, limited to 5 attempts per hour per device. A recovered identity is the SAME user, so switching between Safari and the installed app cannot create two queue spots.
•	One user can have several devices (each with its own push subscription), but only one queue spot per machine type.
•	On iOS, the installed Home Screen app has separate storage from Safari, and Safari may wipe storage after about 7 days of inactivity. The recovery flow exists for exactly this.
5. Queue rules
•	One queue per machine TYPE (washers, dryers). Strict first-come-first-served by join time.
•	A user can hold at most one active spot per type (in the queue, or reserved/running/finished on a machine of that type). A user may be in the washer queue and the dryer queue at once.
•	Joining asks for the display name and an estimated cycle time (15–180 min). Presets: washers 30/45/60, dryers 45/60/90, plus custom.
•	Joining is limited to 5 times per hour per user, so join/leave spamming does not work.
•	Live position (“You are #2”) and an estimated wait computed from machines’ remaining times and queued estimates.
•	If a machine is FREE and the queue is empty, anyone may press “Start now”. The server accepts the first request and rejects the rest with a friendly message.
•	If a machine is FREE and the queue is not empty, only the head of the queue gets it, automatically and atomically inside the same server transaction that freed the machine. Walk-ups cannot cut in.
•	“You’re next” heads-up push when you are first in line and a machine of that type has 5 minutes or less left, or has just become FINISHED.
6. The 10-minute turn window
•	When a machine frees up and it is your turn, it becomes RESERVED for you with a server-side deadline 10:00 away.
•	Alerts: push notification (“It’s your turn! 10 minutes”), a second push at 2 minutes left, plus in-app full-screen modal with confetti, a sound (mute toggle), vibration where supported, and a flashing tab title.
•	Actions: “I’ve loaded it, start!” (switches to RUNNING using your estimate), “I need 5 more minutes” (once per turn), “Give up my turn” (leave the queue), and “The machine isn’t empty” (see section 8).
•	If the window expires: you go to the END of the queue keeping your name and estimate, your missed counter goes up by 1, and the machine passes to the next person with a fresh 10:00. Chat gets a system message (“Sam missed their turn and went to the back of the line”).
•	You cannot be reserved again for 5 minutes after a miss, unless nobody else is waiting (prevents an endless re-reserve loop when you are alone in the queue).
•	A second consecutive miss removes you from the queue entirely and blocks you from joining that type’s queue for 30 minutes. A successful start resets the missed counter.
•	All of this is handled by the server even if the user’s phone is off.
7. Running and finishing a cycle
•	RUNNING has a server-side ends_at. Owners can add +5 or +10 minutes. Total running time is capped (default 240 minutes). Going more than 15 minutes over the original estimate posts a chat notice.
•	Push 5 minutes before the end. At ends_at the machine automatically becomes FINISHED (not FREE), because clothes are probably inside. The owner gets “Your laundry is done” and a reminder 10 minutes later.
•	The owner presses “I’ve collected my stuff” to set it FREE. “Finished early” is available while running.
•	Forgotten laundry: when a machine has been FINISHED for 10+ minutes and someone is in that type’s queue, the owner is pinged first. If there is still no response after 5 more minutes, other users may press “Clothes are out / I moved them”. Two confirmations from two DIFFERENT users on different devices are required (each confirmation expires after 10 minutes). Then the machine becomes FREE, the owner is notified (“Your clothes were moved by X”), and the event is logged.
8. Machine problems and walk-ups
•	Any user can report “Out of order” with a short note. The machine becomes OUT_OF_ORDER and the queue skips it. Anyone can mark it fixed, and an admin can too. Users who repeatedly report falsely can be muted by an admin.
•	If a machine breaks while RUNNING or RESERVED, the owner goes to the FRONT of that type’s queue with a “compensation” badge, and their missed counter is untouched.
•	Walk-ups: anyone can press “Someone is using this” on a FREE machine. It becomes OCCUPIED_UNKNOWN with a default 45-minute estimate and no owner. Two confirmations (or an admin) free it once the clothes are gone.
•	If you are RESERVED and the machine is physically occupied, press “The machine isn’t empty”. The machine becomes OCCUPIED_UNKNOWN, you move back to the FRONT of the queue, you are not penalized, and your window is cancelled.
9. Quiet hours
•	Configurable in the dorm’s time zone (for example 00:00–07:00). Store all timestamps in UTC and convert only for display, so daylight saving changes do not break anything.
•	During quiet hours the server issues no new reservations and sends no push notifications. Machines that free up stay FREE, and anyone may use “Start now”. The queue resumes at the end of quiet hours in its existing order.
•	Reservations already running when quiet hours start finish normally, but no reminder push is sent until quiet hours end.
10. General chat (bulletin board)
•	One real-time chat styled as a corkboard. Message = display name, avatar, time, text (max 280 characters). Kinds: normal, announcement (pinned, max 3, auto-expire after 24 hours), and system (automatic queue and machine events, visually distinct).
•	Rate limit: one message every 2 seconds per user. Basic profanity and spam filter. Block links by default (admin setting).
•	Users can report a message. Admins can delete messages, mute users, and un-pin.
•	Keep the last 200 messages or 48 hours. Unread badge on the chat tab. Render all user text as plain text (never HTML).
11. Notifications on iPhone and Android
•	Android Chrome supports web push in a browser tab and when installed. iPhone supports web push ONLY when the app is installed to the Home Screen (iOS 16.4+) and permission is granted from inside the installed app.
•	Onboarding detects the platform and mode (iOS tab, iOS installed, Android tab, Android installed). On iOS in a tab, show an illustrated guide: Share, then Add to Home Screen, then open SudsQueue from the Home Screen, then enable alerts. On Android, show the install prompt (beforeinstallprompt) and an “Enable alerts” button.
•	Ask for notification permission only after a user tap, never on page load.
•	iOS gotcha: every push must display a visible notification. Silent pushes cause Safari to revoke the subscription.
•	Re-register the push subscription each time the app loads. Delete subscriptions that the push service reports as gone (HTTP 404 or 410).
•	Rate limit and de-duplicate pushes, and cancel a pending one when the state changes (for example, do not send “you’re next” after the person already has the machine).
•	Fallback when push is unavailable: show a banner when joining (“Alerts are off. You might miss your turn. Keep this app open or enable alerts.”) and use in-app alerts. Vibration works on Android only, and audio needs a one-time “Tap to enable sounds” gesture.
12. Cross-platform UI requirements
•	Mobile-first from 320px up. Use 100dvh, viewport-fit=cover, and env(safe-area-inset-*).
•	Inputs use font size 16px or larger (prevents iOS zoom). Tap targets at least 44x44px. No hover-only interactions. Use touch-action: manipulation.
•	Keep the chat input above the on-screen keyboard (VisualViewport API). Handle the Android Back button (close modal or chat first).
•	Set theme-color and apple-mobile-web-app-status-bar-style for light and dark mode.
•	On visibilitychange, focus, and online, reconnect and fetch full state. All countdowns are computed from server timestamps plus a measured clock offset, never from a local counter. Show “Reconnecting…” and never show stale timers as live. Disable action buttons while disconnected (no offline queued actions).
13. Visual design
•	Playful laundromat theme: soft pastel gradients, floating soap bubbles, rounded cards, a friendly display font (Fredoka or Baloo).
•	Illustrated machines (SVG/CSS): front-loading washer with a round glass door and dryer with tumbling orange clothes. RUNNING = spinning drum and rising bubbles. FINISHED = the door “pops” with a “Ding!”. FREE = empty drum with a green glow. RESERVED = pulsing yellow ring with the countdown. OCCUPIED_UNKNOWN = a question-mark tag. OUT_OF_ORDER = grayed with an “Oops” tape.
•	Status uses color AND an icon AND a text label. Progress ring or bar with “12 min left” and “Ready at 21:40”.
•	A “My Status” card at the top. A missing-sock mascot with funny empty states (“No one’s in line. Your socks are safe.”). Confetti when it is your turn.
•	Dark mode (auto + toggle), reduced-motion support, WCAG AA contrast, a small “Live” connection indicator.
•	Layout: Laundry tab (Washers, Dryers, queues) and Board tab (chat). On desktop, chat is a side panel.
14. Data model and protocol
•	Tables: users, devices (token hash, push subscription, last seen), machines (state, owner, reserved_until, started_at, ends_at, finished_at, est_min, ext_used, note, version), queue (unique per user and type), confirmations, messages, events (an audit log of every action), and config.
•	On connect and after every change, the server sends a full state snapshot (the data is small). Clients send commands with a clientActionId. The server replies with success or a coded error (NOT_YOUR_TURN, ALREADY_CLAIMED, RATE_LIMITED, and so on) that the UI turns into friendly text.
15. Admin
•	Admin PIN set through an environment variable (stored hashed, 5 wrong attempts causes a 15-minute lockout). Admins can force-free a machine, mark out of order or fixed, remove people from queues, delete messages, mute or unmute users, rotate the dorm code, edit quiet hours and machine config, and view the audit log.
•	A Device Test page shows platform, install state, push permission, audio state, connection status, and measured clock offset.
•	Demo mode (only when DEMO=1): a fake clock that can be fast-forwarded so the 10-minute window can be tested in seconds.
16. Security and privacy
•	Validate every command on the server: who the user is, whether it is their turn, and whether the state allows it. Escape all user text. Set a strict Content-Security-Policy. Rate limit all endpoints and sockets.
•	Collect no real names, emails, or phone numbers. Keep message and event history short (48 hours for chat, 30 days for audit events). Provide “Delete my data”. If your dorm is in the EU, treat device tokens and push subscriptions as personal data and mention this in the README.
17. Deliverables
•	Full code with a clear structure, the config files, seed data, and unit tests for the state machine (missed turns, simultaneous claims, quiet hours, server restart, daylight saving).
•	README with setup, configuration, deployment, HTTPS notes, iPhone and Android install steps for residents, and a list of assumptions.
Part 2: Extra loopholes found and how they are fixed
1.	Server restarts while a timer is running. Every deadline is stored as a timestamp in the database, and on boot the server runs the same advance() routine that the scheduler runs, so nothing is lost. (Sections 2, 14)
2.	Two people tap at the same time, or one person double-taps. Commands run in a database transaction with a state check, plus a clientActionId for idempotency. (Sections 1, 5, 14)
3.	A lone user who misses their turn is re-reserved forever. A 5-minute re-reserve cooldown, and a second consecutive miss removes them. (Section 6)
4.	The machine physically has someone else’s clothes in it (a walk-up who skipped the app). Added OCCUPIED_UNKNOWN and “The machine isn’t empty”, with no penalty for the reserved user. (Section 8)
5.	A 4-digit recovery PIN can be guessed in 10,000 tries. Replaced with an 8-character code, hashed, and attempt-limited. (Section 4)
6.	Fake confirmations to free someone’s machine. Two different users on different devices, confirmations expire, the owner is pinged first, and every action is logged. Fake identities are limited by the dorm code and one-identity-per-device. (Section 7)
7.	Join/leave spam to grief the queue. Joining is limited to 5 per hour. (Section 5)
8.	Extensions used to hog a machine. A total running cap, a visible “+X min” on the card, and a chat notice for big overruns. (Section 7)
9.	Quiet hours unclear. Defined exactly: no new reservations, no pushes, machines stay FREE, and the queue resumes in its existing order. Times are stored in UTC to survive daylight saving. (Section 9)
10.	iOS revokes push if you send silent pushes. Every push shows a visible notification, and dead subscriptions are deleted. (Section 11)
11.	Pushes arrive after the situation changed. De-duplicate and cancel stale pushes. (Section 11)
12.	The next person is not warned until the machine is already theirs. Added “You’re next” heads-up pushes. (Section 5)
13.	Admin PIN or dorm code leaks. Hashed PIN, lockout, rotatable code, per-user mute. (Sections 4, 15)
14.	Script injection through names or chat. Plain-text rendering, a strict CSP, and server-side length checks. (Sections 10, 16)
15.	Disputes (“I never missed my turn!”). An audit log of every state change with user, machine, and time. (Sections 14, 15)
16.	Offline taps. Buttons are disabled while disconnected, so there are no ghost actions. (Section 12)
17.	Phone clock is wrong. Countdowns use server timestamps plus a measured offset. (Section 12)
18.	Privacy. No real names or contact details, short retention, and a delete option. (Section 16)
Still not fully solvable by software: someone who does not use the app at all, or who moves another person’s clothes. The walk-up button, two-person confirmations, and the audit log reduce the damage but do not remove it. Consider a simple house rule on a poster: “If you use a machine, start it in the app.”
Part 3: Step-by-step implementation guide
Step 1: Decide the basics (30 minutes)
Pick the machine list (counts and labels), the dorm time zone, quiet hours, and the dorm access code. Create a GitHub account and an account on a host such as Fly.io, Render, or Railway. Pick the app name and a domain (optional, the host’s free subdomain works).
Step 2: Set up the project
Create a monorepo with client/ and server/.
npm create vite@latest client -- --template react-ts
cd client && npm i tailwindcss framer-motion socket.io-client
cd ../server && npm init -y
npm i fastify socket.io better-sqlite3 web-push zod
npm i -D typescript vitest tsx
Generate push keys once and keep them secret:
npx web-push generate-vapid-keys
Put the keys, admin PIN, dorm code, and time zone in environment variables (VAPID_PUBLIC, VAPID_PRIVATE, ADMIN_PIN, DORM_CODE, TZ_NAME).
Step 3: Create the database
Write a migration that creates these tables. Enable WAL mode.
users(id, name, name_lower UNIQUE, emoji, recovery_hash, missed_count, blocked_until, muted_until, created_at)
devices(token_hash PRIMARY KEY, user_id, push_sub, last_seen)
machines(id, type, label, state, owner_id, reserved_until, started_at, ends_at, finished_at, est_min, ext_used, note, version)
queue(id, user_id, type, est_min, joined_at, missed_count, UNIQUE(user_id, type))
confirmations(machine_id, user_id, created_at)
messages(id, user_id, kind, text, pinned_until, created_at)
events(id, at, user_id, machine_id, action, detail)
Step 4: Write the state machine first, with tests
This is the heart of the app. Write it as one function with an injectable clock and no networking.
advance(db, now):
  BEGIN IMMEDIATE
  repeat until nothing changes:
    for each machine:
      RUNNING and now >= ends_at      -> FINISHED
      RESERVED and now >= reserved_until -> handleMiss()
      FREE and not quietHours and queue head exists -> RESERVED for head
  COMMIT
  return the list of events (for chat, push, and sockets)
Write Vitest tests for: a missed turn, two misses, a lone user missing, two simultaneous “Start now” calls, quiet hours, a restart in the middle of a window, and a broken machine mid-cycle. Do not move on until these pass.
Step 5: Add the commands
Implement one function per action (join, leave, start, extend, finish, collect, confirmEmpty, reportBroken, markOccupied, notEmpty, sendMessage). Each one runs advance() first, checks that the user may do this, changes state, writes an events row, and returns success or a coded error. Validate input with zod.
Step 6: Add the scheduler
Run advance(db, Date.now()) once on server boot and then every second with setInterval. After each run that changed anything, broadcast the new snapshot and queue the pushes.
Step 7: Add the real-time layer
Use Socket.io. Authenticate each connection with the device token. On connect, send the full snapshot. Receive commands with a clientActionId and send back an ack. Send the server time on connect so the client can compute its clock offset.
Step 8: Add web push
Store each device’s push subscription. Write a sendPush(userId, payload) helper that always shows a visible notification, de-duplicates, and deletes subscriptions that return 404 or 410. Write the service worker’s push and notificationclick handlers. Trigger pushes for: your turn, 2 minutes left, you’re next, done, and done reminder. Skip them in quiet hours.
Step 9: Make it a PWA
Add manifest.webmanifest (name, icons, display: standalone, theme colors), a service worker that caches the app shell, and the apple-touch-icon. Build the onboarding that detects iOS tab, iOS installed, Android tab, and Android installed, and shows the right instructions. Ask for notification permission only after a tap.
Step 10: Build the screens
Build in this order: Welcome (code, name, avatar, recovery code), Laundry screen with “My Status”, machine cards with SVG art, the join dialog, the turn modal with confetti, the Board (chat), and the Device Test page. Compute every countdown from serverNow = Date.now() + offset.
Step 11: Add chat and moderation
Store messages, enforce the 2-second rate limit and 280-character limit, render as plain text, and generate system messages from events. Add report, pin, and delete.
Step 12: Add admin and demo mode
Build the PIN-protected panel from section 15. Add the fake clock behind DEMO=1 so you can fast-forward ten minutes in one click while testing.
Step 13: Test on real phones
Run through this checklist on an iP hone (Safari tab and installed) and an Android phone (Chrome tab and installed): join, wait for your turn, lock the phone, receive the push, start, miss a turn on purpose, report a broken machine, use the keyboard in chat, rotate to landscape, switch to dark mode, and turn off Wi-Fi and back on. Test with two phones at the same time to check simultaneous claims.
Step 14: Deploy
Example with Fly.io (Render and Railway work similarly):
fly launch
fly volumes create suds_data --size 1
fly secrets set VAPID_PUBLIC=... VAPID_PRIVATE=... ADMIN_PIN=... DORM_CODE=...
fly deploy
Mount the volume where the SQLite file lives, keep a single instance, and confirm that the site is served over HTTPS. Add a daily backup of the database file.
Step 15: Launch in the dorm
Print a poster with a QR code to the app and the dorm code, with two-line install steps for iPhone (Share, Add to Home Screen, open it, enable alerts) and Android (Install, enable alerts). Add the house rule: “If you use a machine, start it in the app.” Run a one-week pilot with a few friends first, then announce it to the whole dorm.
Step 16: Maintain it
Check the audit log after the first week to see where people get stuck, adjust the window length or presets in config, rotate the dorm code each semester, and delete old data on schedule.
Shortcut: build it with an AI coding tool
Give Part 1 to Claude Code, but do it in phases instead of all at once: first Steps 3–6 (database and state machine with tests), then Steps 7–8 (sockets and push), then Steps 9–12 (the UI). Review the tests after each phase before continuing.
