# SudsQueue — UI/UX Design Plan

> **Status: DRAFT FOR REVIEW.** Companion to [architecture-plan.md](architecture-plan.md).
> Spec references (§N) point to [building-promt.md](../building-promt.md) Part 1.

## 0. Design direction: "Linen & Tide"

A **classy laundromat**: the calm of freshly folded linen, not a cartoon. Think a boutique
launderette — warm off-white, deep navy ink, a single teal accent, a hint of brushed brass —
with soap bubbles drifting slowly behind everything. Playfulness comes from *motion and copy*
(a spinning drum, a "Ding!", the missing-sock mascot), never from loud colour.

Three rules that keep it classy:
1. **One accent colour.** Teal is the only "brand" colour. State colours appear only as soft
   tints on machine cards, never as big saturated blocks.
2. **Quiet surfaces, expressive details.** Cards are flat linen with hairline borders and one
   soft shadow; the illustration inside the card does the talking.
3. **Slow motion.** Nothing bounces. Easing is gentle (`cubic-bezier(.2,.8,.2,1)`), bubbles take
   18–40 s to rise, state changes cross-fade in 240 ms.

**Starting set:** 3 washers + 3 dryers. Admins can add, rename, reorder and retire machines;
every layout below is built to handle any count from 1 to ~12 per type (§6).

---

## 1. Design tokens

### 1.1 Colour — all text pairs checked at WCAG AA (≥ 4.5:1)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#F5F1EA` linen | `#0F1720` night | page background |
| `--surface` | `#FFFDF9` | `#17212C` | cards, sheets |
| `--surface-2` | `#EFE9DF` | `#1E2A37` | inputs, chips, queue rows |
| `--line` | `#E3DCD0` | `#2A3846` | hairline borders |
| `--ink` | `#1C2B39` (12.8:1) | `#EAF0F5` (15.7:1) | primary text |
| `--ink-muted` | `#5A6672` (5.2:1) | `#9AA8B5` (6.7:1) | secondary text |
| `--accent` | `#2F6F73` tide (5.7:1) | `#7CC4C0` (8.2:1) | primary buttons, links, focus ring |
| `--on-accent` | `#FFFFFF` (5.8:1) | `#0F1720` (9.0:1) | text on accent |
| `--brass` | `#B08A4E` | `#C9A66B` | decorative only (dividers, mascot tag, door dial) — never text |

**Machine state colours** (text/icon colour on its own tint; ratios measured):

| State | Icon | Light fg / tint | Dark fg / tint | Ratio L / D |
|---|---|---|---|---|
| FREE | ✓ circle | `#2E6B4F` / `#E3F1E8` sage | `#7FD1A6` / `#183027` | 5.4 / 7.8 |
| RESERVED | hourglass | `#8A5A00` / `#FBEFD5` honey | `#F2C46B` / `#33280F` | 5.2 / 8.9 |
| RUNNING | spin arrows | `#2D5F8B` / `#E1ECF6` tide-blue | `#8DBBEA` / `#172A3D` | 5.6 / 7.3 |
| FINISHED | bell | `#A23B45` / `#F8E3E4` rose | `#F29AA2` / `#3A1C21` | 5.3 / 7.3 |
| OCCUPIED_UNKNOWN | question tag | `#6A4C8C` / `#EEE7F5` lavender | `#C3A6E8` / `#2A2140` | 5.8 / 7.2 |
| OUT_OF_ORDER | wrench | `#59626B` / `#E9EBED` slate | `#A9B3BD` / `#252D36` | 5.2 / 6.6 |

State is always shown as **colour + icon + text label** (§13), so colour-blind users lose nothing.

### 1.2 Typography

| Role | Font | Size / weight | Notes |
|---|---|---|---|
| Display (app name, modal headline) | **Fraunces** (variable, `SOFT 100`) | 28–40 / 600 | soft serif: classy but friendly |
| UI + body | **Manrope** | 16 / 500; 14 / 500 secondary | inputs always ≥ 16 px (iOS zoom, §12) |
| Timers & numbers | Manrope + `font-variant-numeric: tabular-nums` | 20–56 / 700 | digits don't jitter while counting down |
| Chat notes | Manrope | 15 / 500 | |

Both fonts are **self-hosted** (woff2, `font-display: swap`, latin subset ≈ 70 KB total), which
keeps the CSP at `'self'` and avoids a Google request.
> ⚠ Deviation: the spec suggests Fredoka/Baloo. Those read "kids' app"; Fraunces + Manrope reads
> "boutique". Fredoka stays an option if you prefer the spec's look (decision D1).

Type scale (rem, 1.2 ratio): `0.875 · 1 · 1.2 · 1.44 · 1.728 · 2.074 · 2.488`.

### 1.3 Shape, depth, spacing

- Radius: `--r-sm 10px` (chips, inputs) · `--r-md 18px` (cards) · `--r-lg 28px` (sheets, modal) · pills `999px`.
- Shadow (light): `0 1px 0 rgba(28,43,57,.04), 0 8px 24px -12px rgba(28,43,57,.18)`. Dark: borders do the work, shadow at 40 % opacity.
- Spacing: 4-pt grid — `4 8 12 16 24 32 48`. Page gutter 16 px mobile, 24 px tablet, 32 px desktop.
- Tap targets ≥ 44 × 44 px; primary buttons 52 px tall.

### 1.4 Motion

| Token | Value | Use |
|---|---|---|
| `--ease` | `cubic-bezier(.2,.8,.2,1)` | everything |
| `--t-fast` | 160 ms | press, hover, toggles |
| `--t-med` | 240 ms | state cross-fade, sheet open |
| `--t-slow` | 420 ms | modal entrance, "door pop" |

`prefers-reduced-motion: reduce` → bubbles freeze in place (still visible, as a texture), the
drum stops spinning (a static progress ring shows instead), the bubble burst is replaced by a
fade-in of the headline, and all transitions become 0–80 ms opacity fades.

---

## 2. Signature element: the floating bubble background

One fixed layer behind the whole app. Pure CSS, no JS per frame, no canvas.

```html
<div class="bubbles" aria-hidden="true">   <!-- position:fixed; inset:0; z-index:0; pointer-events:none -->
  <span style="--x:8%; --s:44px; --d:26s; --delay:-3s; --drift:18px"></span>
  <!-- 14 spans on desktop; 8 on mobile (hide :nth-child(n+9) under 640px) -->
</div>
```

```css
.bubbles span{
  position:absolute; left:var(--x); bottom:-100px; width:var(--s); aspect-ratio:1; border-radius:50%;
  background:
    radial-gradient(circle at 30% 28%, rgba(255,255,255,.9) 0 8%, transparent 9%),        /* highlight */
    radial-gradient(circle, transparent 58%, rgba(124,196,192,.28) 72%,
                    rgba(176,138,78,.18) 86%, transparent 100%);                           /* tide→brass rim */
  box-shadow: inset 0 0 0 1px rgba(255,255,255,.35);
  opacity:.55; will-change:transform;
  animation: rise var(--d) linear var(--delay) infinite;
}
.bubbles span::after{ /* sway on a child so the two transforms don't fight */ }
@keyframes rise { to { transform: translate3d(var(--drift), calc(-100dvh - 200px), 0); } }
.bubbles.paused span{ animation-play-state: paused; }          /* toggled on document.hidden */
@media (prefers-reduced-motion: reduce){ .bubbles span{ animation:none; bottom:auto; top:var(--y); } }
```

- **Depth**: three size bands — small (12–20 px, 40 s, 35 % opacity, `blur(1px)`), medium
  (28–44 px, 26 s), large (60–90 px, 18 s, 25 % opacity). Fewer, slower, bigger = classier.
- **Dark mode**: rim uses `--accent` at 22 %, highlight at 50 % — the bubbles glow faintly.
- **Behind cards, not on top**: cards are opaque `--surface`, so bubbles show only in gutters and
  the header. Content is never covered and contrast is unaffected.
- **Performance**: only `transform` animates (compositor-only); paused when the tab is hidden;
  ≤ 14 elements. Budget: no frame > 4 ms on a mid-range Android.
- **Event moments** (same bubble style, reused):
  - RUNNING washer: 3–5 tiny bubbles rise *inside* the drum.
  - Your turn: a burst of 12 bubbles from the modal centre that drift out and pop
    (scale 1 → 1.15, fade). This replaces paper confetti (decision D2).
  - Admin adds a machine: the new card fades in with 3 bubbles.

---

## 3. Information architecture

```
Onboarding (first visit only)
  Welcome → Dorm code → Name + avatar → Recovery code → Alerts setup (platform-specific)

App shell
  ├─ Laundry   (home)  — My Status · Washers · Dryers · queues
  ├─ Board             — corkboard chat, pinned announcements
  └─ ⋯ menu            — Theme · Sounds · Device test · Recover account · Delete my data · Admin

Overlays: Machine sheet · Join sheet · Turn modal · Report sheet · Toasts · Reconnecting bar
Admin (PIN): Machines · Queues · Board · Users · Settings · Audit log
```

Mobile: top bar + bottom tab bar (Laundry | Board). Desktop ≥ 1024 px: Laundry on the left,
Board as a fixed right panel (380 px), no tab bar (§13).

---

## 4. Screens

### 4.1 Onboarding

One card centred on the bubble background, 4 progress dots at the top, one primary action per
step, Back always available.

```
┌──────────────────────────────┐
│ ●  ○  ○  ○                   │
│                              │
│        🧺  SudsQueue          │   ← Fraunces 36, brass hairline under it
│   The laundry room, sorted.   │
│                              │
│  Dorm code                   │
│  ┌────────────────────────┐  │   ← 16 px input, autocapitalize=characters
│  │ ••••••                 │  │
│  └────────────────────────┘  │
│  [        Continue        ]  │
│                              │
│  I already have an account → │
└──────────────────────────────┘
```

- **Name + avatar**: name input with a live "available ✓ / taken" hint; avatar = 4 × 4 grid of
  16 emoji in round linen chips; the selected chip gets an accent ring.
- **Recovery code**: shown on a "laundry ticket" card (perforated top edge, brass border),
  monospace, grouped `ABCD-EFGH`. Buttons: *Copy*, *Save as image*. "I saved it" checkbox is
  required to continue. Copy: "If your phone forgets you, this ticket brings you back."
- **Alerts setup** depends on the platform (§11):
  - *iOS, Safari tab*: 3-step illustrated guide (Share → "Add to Home Screen" → open from the
    Home Screen). Honest note: "On iPhone, alerts only work from the Home Screen app."
    Secondary: "Continue without alerts".
  - *iOS installed / Android / desktop*: big "Enable alerts" button (permission requested on
    this tap only), plus a "Tap to enable sounds" toggle. Android tab also shows "Install app".

### 4.2 Laundry (home)

```
┌──────────────────────────────┐  ← safe-area top padding
│ SudsQueue            ● Live ⋯│  ← Live dot: sage pulse / honey "Reconnecting…"
├──────────────────────────────┤
│ ┌ My status ───────────────┐ │  ← surface card, accent left rule
│ │ 🧺 Washers  You're #2     │ │
│ │            ~18 min wait   │ │
│ │ 🌀 Dryers  Not in line    │ │
│ │                  [ Join ] │ │
│ └──────────────────────────┘ │
│                              │
│ Washers        2 free · 1 ⟳  │  ← section header + summary chip
│ ┌──────────────────────────┐ │
│ │ (art) Washer 1   ✓ Free   │ │  ← compact row card (mobile)
│ │       Ready now  [Start]  │ │
│ ├──────────────────────────┤ │
│ │ (art) Washer 2   ⟳ 12 min │ │
│ │ 🦊 Ana · ready 21:40  ▓▓░ │ │
│ ├──────────────────────────┤ │
│ │ (art) Washer 3   ⏳ 6:12  │ │
│ │ Reserved for Sam 🐸       │ │
│ └──────────────────────────┘ │
│ In line: ① Ben 🐼 ② You 🐙   │  ← queue as avatar chips, "You" in accent
│ [    Join washer line    ]   │
│                              │
│ Dryers         3 free        │
│ …                            │
├──────────────────────────────┤
│   🧺 Laundry      📌 Board •3 │  ← tab bar, safe-area bottom
└──────────────────────────────┘
```

- **My Status** comes first and changes with your situation: not in a line → two "Join"
  buttons · waiting → position + estimate · *your turn* → honey card with countdown and "Start"
  (mirrors the Turn modal) · running → your progress ring + "ready at" · finished → rose
  "Your laundry is done — collected?".
- **Machine card (mobile row)**: 72 px illustration on the left, label + state pill on the
  right, one line of detail, at most one contextual action. Tapping opens the **Machine sheet**
  with every action (extend, report broken, "someone is using this", confirm clothes out).
- **Alerts-off banner** (§11) shows above My Status when push is unavailable and you are in a
  line: honey tint, "Alerts are off — keep SudsQueue open or enable alerts." + button.

### 4.3 Machine illustration states

One SVG per type (120 × 140 viewBox, refined from `sudsqueue.html:124-132`): rounded cabinet,
control strip with a brass dial, round glass door with a subtle reflection arc. The dryer adds
a vent grille and warm-orange tumbling clothes.

| State | Door / drum | Ring | Motion | Label |
|---|---|---|---|---|
| FREE | empty glass, soft sage inner glow | sage 30 % | glow breathes (4 s) | ✓ Free |
| RESERVED | empty | honey ring with a **countdown arc** | ring pulses (2 s) | ⏳ Reserved · 6:12 |
| RUNNING | water line + clothes; washer: rising micro-bubbles; dryer: tumbling | tide-blue **progress arc** | drum 3 s / rev | ⟳ 12 min · ready 21:40 |
| FINISHED | still drum, door opens 12° | rose | one-time "door pop" + "Ding!" tag | 🔔 Done · waiting 8 min |
| OCCUPIED_UNKNOWN | blurred clothes silhouette | lavender, dashed | none | ? In use (no app) · ~45 min |
| OUT_OF_ORDER | greyed (`saturate(.2)`) | none | none | 🔧 Out of order + diagonal "OOPS" tape |

Arcs are computed from server timestamps (`ends_at`, `reserved_until`) + the clock offset.
While disconnected, arcs and timers turn grey with "—" and buttons are disabled (§12).

### 4.4 Join sheet (bottom sheet)

```
┌──────────────────────────────┐
│ ───                          │  ← grabber
│ Join the washer line         │
│ You'll be #3 · ~25 min wait  │
│ How long is your cycle?      │
│ ( 30 ) ( 45 ) ( 60 ) (Custom)│  ← segmented pills; Custom → stepper 15–180
│ ⓘ Alerts are on for this     │
│   device                     │
│ [       Join line        ]   │
└──────────────────────────────┘
```

### 4.5 Turn modal — the hero moment

Full-screen honey-tinted sheet over the dimmed app. Bubble burst on entry (§2), soft chime (if
sounds are on), `navigator.vibrate([120,60,120])` on Android, tab title flashes
"⏳ Your turn! — SudsQueue".

```
┌──────────────────────────────┐
│                              │
│           ◯ 9:41              │  ← 56 px tabular timer inside a depleting honey ring
│     It's your turn, Ben       │  ← Fraunces 32
│   Washer 2 is held for you    │
│                              │
│ [  I've loaded it — start  ]  │  ← primary, accent
│ [   +5 minutes (once)      ]  │  ← secondary
│   The machine isn't empty     │  ← text button
│   Give up my turn             │  ← text button, muted
└──────────────────────────────┘
```

Under 2:00 the ring and timer shift to rose (and the second push fires). Back button / gesture
**minimises** to the My Status card — it never silently dismisses the turn.

### 4.6 Board (corkboard chat)

A classy corkboard: `--surface-2` background with a faint cork grain (SVG noise at 4 %
opacity). Messages are **linen notes** with a tiny brass pin, rotated ±0.6° (derived from the
message id, so notes don't jiggle on re-render).

- **Pinned announcements** (max 3): a row of larger notes at the top with a brass 📌.
- **System messages**: no note — centred small caps in `--ink-muted` between thin rules
  ("— Sam missed their turn and went to the back of the line —").
- Your own notes align right with an 8 % accent tint.
- Composer stays above the keyboard (VisualViewport); a 280-char counter appears from 240;
  send is disabled while offline or rate-limited ("wait 1 s").
- Long-press / ⋯ on a note → Report. Plain-text rendering only.

### 4.7 Device test

A checklist card: Platform · Installed · Push permission · Push subscription · Sounds ·
Vibration · Connection · Clock offset (± ms). Each row = icon + status pill + "Fix" link where
possible. Button: "Send me a test alert".

### 4.8 Admin

Entered via ⋯ → Admin → PIN pad (large keys; lockout message after 5 fails). Admin mode adds a
thin brass bar at the top: "Admin mode · Exit".

Sections (tabs on desktop, list on mobile): **Machines · Queues · Board · Users · Settings · Audit log**.

**Machines manager** — the "admin can add more" requirement:

```
┌──────────────────────────────┐
│ Machines                     │
│ Washers (3)         [+ Add]  │
│ ≡ Washer 1   Free       ⋯    │  ← ≡ drag handle (desktop) / ▲▼ (mobile)
│ ≡ Washer 2   Running    ⋯    │
│ ≡ Washer 3   Free       ⋯    │
│ Dryers (3)          [+ Add]  │
│ ≡ Dryer 1    Free       ⋯    │
│ ≡ Dryer 2    Finished   ⋯    │
│ ≡ Dryer 3    Free       ⋯    │
│ Retired (0)               ▸  │
└──────────────────────────────┘
```

- **Add**: sheet with Type (preselected), Label (suggests "Washer 4"), default estimate. The new
  machine appears FREE on every client at once and joins the queue rotation immediately.
- **⋯ per machine**: Rename · Mark out of order / fixed · Force free · Retire.
- **Retire** instead of delete: allowed only when FREE or OUT_OF_ORDER; a busy machine shows
  "Finish or force-free it first". Retired machines keep their audit history and can be restored.
- Reorder by drag on desktop and ▲▼ buttons on mobile (no drag-only interaction).
- Every change is written to the audit log and posted as a system message ("Admin added Washer 4").

Other admin tabs: **Queues** (remove a person, with reason) · **Board** (delete, unpin, links
on/off) · **Users** (mute/unmute, until) · **Settings** (rotate dorm code, quiet hours + time
zone, window length, presets) · **Audit log** (filter by machine/user/action, 30 days).

---

## 5. Microcopy & mascot

Voice: warm, brief, a little dry. Never blames the user.

| Moment | Copy |
|---|---|
| Empty line | "No one's in line. Your socks are safe." |
| All machines free | "Every machine is free. Rare. Enjoy it." |
| All out of order | "Everything's out of order. The sock is investigating." |
| Missed turn (you) | "You missed your turn, so you're at the back of the line. It happens." |
| Second miss | "You've been taken out of the line for 30 minutes." |
| Quiet hours | "Quiet hours until 07:00. Machines are first come, first served." |
| Reconnecting | "Reconnecting… timers paused until we're back." |
| `ALREADY_CLAIMED` | "Someone beat you to it — by a second." |
| `RATE_LIMITED` | "Easy there. Try again in a moment." |

**Mascot**: one striped sock with a brass tag, drawn in two colours (ink + accent). Appears only
in empty states, onboarding step 1 and the 404 page; max 120 px; never on busy screens.

---

## 6. Responsive layout (scales past 3 + 3)

| Width | Machines | Board |
|---|---|---|
| 320–639 px | **Row cards**, one column — works for any machine count | Tab |
| 640–1023 px | Grid `repeat(auto-fill, minmax(200px, 1fr))`, tall cards with large art | Tab |
| ≥ 1024 px | Same grid in the left column (max 880 px) — 3 + 3 shows as two rows of 3 | Right panel, 380 px |

Nothing assumes "3": each section header shows a summary chip ("2 free · 1 running") so a long
list scans at a glance, and sections with > 6 machines tuck Out-of-order machines into a
disclosure at the end.

Always: `100dvh`, `viewport-fit=cover`, `env(safe-area-inset-*)` on top and tab bars,
`touch-action: manipulation`; landscape phones get the 640 px grid.

---

## 7. Accessibility

- All colour pairs in §1.1 measured ≥ 4.5:1. Focus ring: 2 px `--accent` + 2 px offset on every surface.
- Each machine card is one `<button>` with a full name, e.g.
  "Washer 2, running, 12 minutes left, ready at 21:40, owner Ana".
- Countdowns are **not** announced every second; one `aria-live="polite"` region announces only
  milestones (your turn, 2 minutes left, done).
- Turn modal: `role="alertdialog"`, focus on the primary button, focus trapped, Esc / Back = minimise.
- Bubbles and illustrations are `aria-hidden` and never carry information.
- Works at 200 % text zoom: row cards wrap to two lines; timers never truncate.
- Reduced motion honoured everywhere (§1.4). Dark mode: auto + manual toggle in the ⋯ menu.

---

## 8. Component inventory (`client/src/components/`)

`BubbleField` · `TopBar` (+ `LiveDot`) · `TabBar` · `MyStatusCard` · `MachineSection` ·
`MachineCard` (row + tile) · `MachineArt` (washer/dryer × 6 states) · `ProgressRing` ·
`StatePill` · `QueueChips` · `Sheet` · `JoinSheet` · `MachineSheet` · `TurnModal`
(+ `BubbleBurst`) · `Board` · `Note` · `Composer` · `Banner` · `Toast` · `InstallGuide` ·
`RecoveryTicket` · `PinPad` · `AdminMachines` · `EmptyState` (+ `Sock`).

Tailwind v4: the §1 tokens live in `@theme` in `styles.css`; dark mode via `[data-theme]` +
`prefers-color-scheme`, the same pattern as `sudsqueue.html:8-11`.

---

## 9. Build order (within architecture Phase C)

1. Tokens + fonts + `BubbleField` + app shell (top bar, tab bar, themes) — review the *feel* first.
2. `MachineArt`, all 12 variants, on a dev-only "state gallery" page — review.
3. Laundry screen with a mocked snapshot, then live data.
4. Sheets + Turn modal + bubble burst.
5. Board.
6. Onboarding + install guide.
7. Admin (Machines manager first), Device test.

Each step ends with a screenshot check at 375 px and 1280 px, light + dark, reduced motion on.

---

## 10. Decisions for you

| # | Question | Default in this plan |
|---|---|---|
| D1 | Fonts: **Fraunces + Manrope** (classy) or the spec's Fredoka (playful)? | Fraunces + Manrope |
| D2 | Your-turn celebration: **bubble burst** or paper confetti (spec)? | Bubble burst |
| D3 | Removing a machine: **retire (restorable)** or hard delete? | Retire |
| D4 | Palette "Linen & Tide" OK, or a different accent (navy, sage)? | Tide teal |
