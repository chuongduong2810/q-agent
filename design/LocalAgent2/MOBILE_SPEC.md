# Q-Agent Mobile — Implementation Spec

Derived from the standalone mockup (`design/Q-Agent_mobile/Mobile/Q-Agent Mobile.dc.html`).
Goal: make the real React+Tailwind app responsive so that at narrow widths it matches this
single-column phone layout. Same dark-glass theme (`#0a0a0f`/`#07070b` bg, purple→indigo
`#8b5cf6 → #6366f1`, Satoshi + JetBrains Mono). Designed at **430 × 900**.

All numbers below are lifted verbatim from the mockup so they can be used as-is.

---

## 1. Shell / navigation model

The whole app is a vertical flex column: **top bar → (in-run) stepper → scrollable main →
(optional) bottom action bar**, with drawer / sheets / toast as absolutely-positioned overlays
inside the same container.

### 1a. Top bar (`<header>`)
- `flex-shrink:0`, `padding:14px 15px 12px`, `background:rgba(12,12,18,.72)`,
  `backdrop-filter:blur(22px)`, `border-bottom:1px solid rgba(255,255,255,.06)`, `z-index:20`.
- **Three slots, `gap:12px`, `align-items:center`:**
  - **Left — hamburger**: 40×40, `border-radius:12px`, `background:rgba(255,255,255,.05)`,
    `border:1px solid rgba(255,255,255,.08)`; active state `background:rgba(255,255,255,.12)`.
    Icon = 3-line menu, 19px, stroke 2.1.
  - **Center — title block** (`flex:1;min-width:0`, both lines ellipsis-truncated):
    title **15.5px / weight 800**, letter-spacing `-.01em`; subtitle **10.5px**, color `#7a7a8c`,
    weight 500.
  - **Right — primary action**, 40×40, `border-radius:12px`. Two variants:
    - Global screens → **"+"** (new run): purple gradient bg + shadow `0 6px 16px -5px rgba(139,92,246,.7)`.
    - Inside a run → **"✕"** (exit run): neutral `rgba(255,255,255,.05)` + `1px` border, color `#c7c7d4`.
- Title/subtitle map: global screens use a `titles` table (e.g. Dashboard/"Overview",
  Runs/"5 total"); in-run uses `stageNames[screen]` (Run overview, Review Center, Sync,
  Automation, Execution, Evidence, Publish) with subtitle = `RUN-ID · run name`.

### 1b. Hamburger drawer (left slide-in)
- **Scrim**: `position:absolute;inset:0;background:rgba(4,4,8,.62);backdrop-filter:blur(2px);`
  `z-index:40`; animation `scrimIn .25s ease` (opacity fade). Tap closes.
- **Panel (`<aside>`)**: `position:absolute;top:0;bottom:0;left:0;width:82%;max-width:320px;`
  `z-index:41;background:rgba(15,15,22,.97);backdrop-filter:blur(30px);`
  `border-right:1px solid rgba(255,255,255,.08);box-shadow:30px 0 70px -20px rgba(0,0,0,.8)`;
  animation `drawerIn .3s cubic-bezier(.2,.8,.2,1)` (`translateX(-100% → 0)`). Own vertical scroll.
- **Contents top→bottom:**
  1. Brand header: 36×36 gradient logo tile + "Q‑Agent" (17px/900) + "QA OPERATING SYSTEM"
     (9.5px, letter-spacing .05em) + close button (32×32).
  2. **In-run only**: run-context card (gradient, run id + status pill + name + meta) followed by
     a **"← All of Q‑Agent"** button that exits the run.
  3. Section heading — **"WORKSPACE"** normally, **"PIPELINE"** in-run (10px, letter-spacing .12em, `#5c5c6e`).
  4. **Nav list** — items: Dashboard, Projects, Tickets, **Runs (badge "1")**, Review Center,
     Reports, Audit Log, Settings. Row: `gap:13px;padding:11px 12px;border-radius:12px;font-size:14px`.
     Active row = filled purple gradient `linear-gradient(135deg,rgba(139,92,246,.9),rgba(99,102,241,.75))`,
     text `#ECECF1`/700; inactive transparent, `#a0a0b2`/600.
  5. **Admin section** (only when `role==='admin'` **and not in a run**): divider + "ADMIN"
     label with a small "RESTRICTED" pill, then Team + Claude Credentials.
  6. Spacer, then **AI credits** card (label + "2,840 / 5,000" + progress bar at 57%).
  7. **Profile** row (initials avatar + name + role) with a demo **role toggle button** (Admin ⇄ Member).

### 1c. In-run pipeline stepper (swipeable rail)
- Rendered only when `inRun`, directly under the top bar.
- `flex-shrink:0;display:flex;gap:7px;overflow-x:auto;padding:11px 15px;`
  `background:rgba(12,12,18,.5);border-bottom:1px solid rgba(255,255,255,.05);z-index:19;`
  `scroll-behavior:smooth`. Scrollbar hidden via `.scrl`.
- **7 pills**: Overview · Review · Sync · Automation · Execution · Evidence · Comment (Publish).
  Pill: `padding:6px 12px 6px 7px;border-radius:20px;font-size:12px;font-weight:700;white-space:nowrap`.
  - Active: border `rgba(139,92,246,.5)`, bg `rgba(139,92,246,.18)`, text `#ECECF1`.
  - Inactive: border `rgba(255,255,255,.08)`, bg `rgba(255,255,255,.03)`, text `#8b8b9e`.
  - Each pill leads with a **19×19 numbered dot**; done stages show a check (filled gradient),
    active stage filled gradient, future stages `rgba(255,255,255,.09)` with grey number.
- **Auto-scroll to active**: on every update, `requestAnimationFrame` → center the
  `[data-active="1"]` pill: `scrollTo({left: act.offsetLeft-(clientWidth-act.offsetWidth)/2, behavior:'smooth'})`.

### 1d. Main content region
- `<main>`: `flex:1;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;`
  `padding:16px 15px calc(16px + var(--pad-bottom,0px));z-index:5`. Scrollbar hidden.
- **Scroll resets to top on every screen change**; Dashboard re-triggers count-up animations.
- Screen sections mount/unmount via conditionals — one screen visible at a time; each wraps in
  `animation:fadeInUp .45–.55s ease both`.

---

## 2. Breakpoint / layout container

- **Root column**: `position:relative;z-index:2;width:100%;max-width:480px;margin:0 auto;`
  `height:100vh;display:flex;flex-direction:column;overflow:hidden`. → single centered column,
  capped at **480px**, full-height, internal scroll only in `<main>`.
- **Background** (behind column, `pointer-events:none`): two fixed layers —
  `radial-gradient(120% 80% at 50% 0%,#12101c,#07070b 70%)` (`z-index:0`) and a three.js
  constellation canvas (`z-index:1;opacity:.9`). App content sits at `z-index:2`.
- `body{overflow:hidden}`; global `::selection` purple; links `#a78bfa`.
- **Safe areas**: bottom-anchored chrome adds `env(safe-area-inset-bottom)` to bottom padding.
- **Responsive mapping for the React app**: treat everything above as the **`< 480px` (or a
  `md:` breakpoint) layout**. Desktop keeps `GlobalSidebar`/`RunSidebar`; below the breakpoint,
  sidebars collapse into the drawer, the desktop header becomes the mobile top bar, and run nav
  becomes the stepper rail. Keep it URL-driven (per project ADR 0003/0004) — the drawer/stepper
  are just responsive presentations of the same routes, not new state.

### Keyframes available
`fadeInUp` (14px rise), `drawerIn`, `scrimIn`, `sheetIn` (translateY 100%→0), `toastIn`,
`pulseDot`, `spin`, `think` (thinking-dot stagger), `barGrow` (`scaleY` for chart bars), `shimmer`.

---

## 3. Per-screen layout notes (desktop multi-column → mobile single column)

**Dashboard** — everything stacks vertically:
- Greeting + active-project name (22px/900).
- Full-width **continue-run hero** (gradient card: run id + status pill + name + meta + CTA arrow).
- **KPI grid → 2 columns** (`grid-template-columns:1fr 1fr;gap:10px`), 4 stat cards (icon + delta + count-up value + label).
- **Suite health**: 7 vertical bars, `height:88px`, pass = purple gradient, fail = red segment stacked below (`barGrow` anim).
- **Recent runs** list (3 rows) with "View all"; **Recent activity** list (5 rows) in a bordered container.

**Projects** — the desktop card grid becomes a single-column stack of full-width project cards
(glyph + name + provider + status pill; indexed ones show a "Knowledge confidence" bar; footer = tickets / runs / pass-rate).

**Project detail** — provider+status row; gradient **Knowledge base** card (confidence % + bar + last-indexed/repo);
**3-column stat grid** (`1fr 1fr 1fr`: Tickets / Page obj. / Fixtures); TECH STACK = wrapping pills; full-width "View tickets" secondary button.

**Tickets** — search bar on top; desktop table → **row cards**. Each row = left **checkbox**
(24×24, gradient when selected) + tappable body (provider glyph + id + priority pill / title / status·sprint·AC row).
Multi-select surfaces a **floating "Create run · N selected"** pill (bottom-center, `bottom:calc(18px+safe-area)`, width `calc(100%-30px)`, max 440px).

**Ticket detail** — header (glyph + id + status pill); title 20px/900; meta pills (priority/assignee/sprint);
description + QA-note card; **Acceptance criteria** numbered list; **Linked PRs** list; full-width "Generate test cases" primary.

**Runs board** — **horizontal-scroll filter chips** on top; run cards stack: top row id + status pill + pass-rate (right-aligned),
name, thin 5px progress bar, meta row (cases · tickets · framework · ago).

**Review Center** (primary phone job) — 3-up **summary chips** (Approved / Pending / Rejected).
Then **two-level accordion** of ticket cards: header (glyph + id/title + `appr/total` count pill + chevron) →
expand → "Approve all N cases" + per-case cards → expand case → meta pills (automation/testType/dur) +
PRECONDITION + numbered STEPS (`action → expected`) + Reject/Approve buttons.
**Sticky bottom action bar present on this screen only.**

**Sync** — three states: **idle** (centered icon card "Push N cases back" + "Create & link" primary + "Create only" secondary),
**running** (step list with spinner / check / empty-circle states), **done** (green success banner + per-ticket result cards listing created case ids + "Generate automation" button).

**Automation** — **thinking** (gradient card "Writing Playwright specs…" + step list) → **done**:
**horizontal-scroll file tabs**, then a code viewer card (filename header + Copy button + `<pre>` with its **own horizontal scroll**, monospace 11px) + "Run tests" primary.

**Execution** — **idle** (centered "Run N automated tests" + Start), **running** (progress card w/ spinner + %),
**done** (2 stat tiles Passed/Failed). Always a **terminal-style row list** (monospace: status dot + tid + cid + ellipsized title + status pill) — the desktop results table becomes this compact list. Done → "View evidence".

**Evidence** — **horizontal-scroll ticket chips** (select active) + **segmented tab bar**
(screenshot / video / trace / console) + artifact viewer card (browser-chrome dots + 200px preview) + caption + "Publish results" primary.

**Publish / Comment** — intro text + per-ticket result cards (glyph + id/title + status pill + pass/fail dots + kind);
optional "Retry failed" (red) + "Publish to all tickets" primary → disabled "Publishing…" spinner state.

**Reports** — **KPI grid → 2 columns** (count-up); **Pass-rate chart** card (7 bars, `height:96px`, same bar component as Dashboard); **Flaky tests** list (warning icon + name/sub + flake-rate).

**Audit Log** — search bar + **horizontal-scroll category chips** + **vertical timeline**
(left rail of glowing colored dots joined by a 2px line; each event = category badge + `day ts` + actor/action + target + monospace meta). Desktop table columns collapse into the stacked timeline entry.

**Settings** — sectioned single column: **INTEGRATIONS** list (glyph + name/sub + status pill);
**EXECUTION** card (parallel-workers value + **range slider** `accent-color:#8b5cf6` + toggle-switch rows with track+knob);
**CLAUDE CREDENTIAL** = **segmented control** (Shared team / My account) + helper text.

**Admin · Team** — 2 stat tiles (Members / Active) + user rows (gradient initials avatar + name/email + role pill + status).

**Admin · Claude Credentials** — intro + credential cards (sparkle icon + label/email + "DEFAULT" pill + plan/expiry/refreshed meta) + dashed **"Upload credential"** button.

---

## 4. Reusable mobile patterns to extract

1. **Glass card token** — `border:1px solid rgba(255,255,255,.07–.08)`, `border-radius:14–20px`,
   `background:rgba(20,20,28,.5–.55)`, `backdrop-filter:blur(20px)`. The atom for every list item / panel.
2. **Primary CTA button** — full-width, `padding:15px`, `border-radius:15px`,
   `background:linear-gradient(135deg,#8b5cf6,#6366f1)`, `box-shadow:0 10px 26px -8px rgba(139,92,246,.7)`,
   `font-size:14px;font-weight:800`, usually with a trailing arrow icon. **Secondary** = `rgba(255,255,255,.05)` bg + `1px` border.
3. **Sticky bottom action bar** — `flex-shrink:0` footer with `env(safe-area-inset-bottom)` padding,
   glass bg `rgba(12,12,18,.86)`; shows a progress summary + progress bar + dual buttons
   (secondary "Approve all" + primary "Continue", primary uses `flex:1.35` and a disabled/`.5 opacity` state).
4. **Floating selection CTA** — absolutely-positioned pill (`translateX(-50%)`, `bottom:calc(18px+safe-area)`,
   width `calc(100%-30px)` max ~440px) that appears when a selection exists (`fadeInUp`).
5. **Bottom sheet** — scrim (z50) + panel (z51) anchored bottom, `max-height:88%`, own scroll,
   `border-radius:26px 26px 0 0`, `background:rgba(17,17,24,.99)`, **grab handle** (40×4 pill),
   `animation:sheetIn .35s cubic-bezier(.2,.8,.2,1)`. Used for New-run form; reuse for any picker/form.
6. **Segmented pill control** — small equal buttons in a `rgba(255,255,255,.04)` track with border;
   active = purple tint. Used for framework/env/credential-source/evidence tabs.
7. **Horizontal-scroll chip rail** — `display:flex;gap;overflow-x:auto` + `class="scrl"` (scrollbar hidden);
   chips `flex-shrink:0;white-space:nowrap`. Used for run filters, audit categories, automation file tabs, evidence ticket chips, and the pipeline stepper.
8. **Cards, never tables** — desktop tables become either row-cards (Tickets, Runs) or a compact
   monospace row list (Execution, Sync results). No horizontal-scrolling data grids except code (`<pre>`).
9. **Nested disclosure / accordion** — Review Center's ticket → case → detail (three levels) with rotating chevrons.
10. **KPI grid** — default **2 columns** (`1fr 1fr`, gap 10px); **3 columns** for compact project stats.
11. **Progress bar** — `height:5–7px`, rounded, track `rgba(255,255,255,.08)`, fill `linear-gradient(90deg,#8b5cf6,#22d3ee)`.
12. **Bar chart** — flex row of full-height columns, each `barGrow` animated; stacked pass(gradient)/fail(red) segments. Shared by Dashboard + Reports.
13. **Status / priority / provider chips** — consistent small pill vocabulary; provider glyph badge
    (`A` = Azure DevOps `#0078d4`, `J` = Jira `#2684ff`) with colored tile.
14. **Toast** — bottom-center, glass, icon + message + optional subtitle, `animation:toastIn .4s`.
15. **Toggle switch** — track + knob rows (Settings execution toggles); **range slider** with `accent-color:#8b5cf6`.
16. **Process/step indicator** — round status nodes in three states: done (filled gradient + check),
    active (spinner border-top `#c4b5fd`, `animation:spin .8s`), pending (hollow ring). Used in Sync + Automation.
