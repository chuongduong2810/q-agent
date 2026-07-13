# Q-Agent · Mobile

The full Q-Agent QA operating system, redesigned as a native-feeling phone app.
Same dark-glass visual language as the desktop app (near-black `#0a0a0f`, purple→indigo
`#8b5cf6 → #6366f1` accents, Satoshi + JetBrains Mono, live constellation background),
re-laid-out for a single narrow column with a hamburger drawer instead of the desktop
sidebar.

## Contents

```
Mobile/
├─ Q-Agent Mobile.dc.html          # the app (Design Component source)
├─ Q-Agent Mobile (standalone).html # single-file offline build
└─ support.js                       # runtime the .dc.html loads
```

Open `Q-Agent Mobile.dc.html` directly in a browser, or drop the standalone build into
any WebView / phone shell. Designed at 430 × 900; the layout fills its container and
caps at a 480px column so it also reads well on desktop.

## Navigation

- **Glass top bar** — hamburger (left), screen title + context (center), primary action
  (right: **＋ new run**, or **✕ exit** inside a run).
- **Hamburger drawer** — Workspace (Dashboard, Projects, Tickets, Runs, Review Center,
  Reports, Audit Log, Settings) and, for admins, an **Admin** section (Team, Claude
  Credentials). Shows the active run context + credits + profile. Includes a demo
  role switch (Admin ⇄ Member).
- **Pipeline stepper** — inside a run, a swipeable rail (Overview · Review · Sync ·
  Automation · Execution · Evidence · Publish) that auto-scrolls to the active stage.

## Screens

**Workspace:** Dashboard (continue-run hero, KPI grid, 7-day suite health, recent runs,
activity), Projects + Project detail (knowledge base, tech stack), Tickets + Ticket
detail (search, multi-select → create run, acceptance criteria, linked PRs), Runs board
(filters, per-run progress), Reports (KPIs, pass-rate trend, flaky tests), Audit Log
(search + category filter, timeline), Settings (integrations, execution toggles,
credential source), Admin · Team, Admin · Claude Credentials.

**Run pipeline** (optimized for the primary phone job — review & approve):
Run overview → **Review Center** (expandable ticket groups, per-case approve / reject,
sticky progress bar with *Approve all* / *Continue to Sync*) → Sync (create & link
test cases) → Automation (generated Playwright specs) → Execution (live run + pass/fail)
→ Evidence (screenshot / video / trace / console) → Publish (post results to each ticket).

## Tweaks (Design Component props)

- `role` — `admin` | `member` (controls the Admin section)
- `showParticles` — toggle the three.js constellation background

## Relationship to the desktop app

This is a parallel, standalone screen set — the desktop `Q-Agent.dc.html` at the project
root is untouched. Content and data mirror the desktop app so the two stay in sync
conceptually; edit this file to evolve the mobile experience independently.
