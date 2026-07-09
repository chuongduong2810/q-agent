# CLAUDE.md — Q-Agent

Project-specific guidelines. Merge with the global `~/.claude/CLAUDE.md`.

## Debugging

- For visual layering/rendering bugs, inspect the live DOM (e.g. `elementFromPoint`, computed styles) to find the actual cause **before** fixing. Don't iterate on opacity/z-index guesses.

## Frontend (React / Tailwind / Framer Motion)

- Render floating overlays (dropdowns, popovers, tooltips, menus) via a portal to `document.body` with fixed positioning anchored to the trigger's bounding rect. Ancestor `backdrop-filter`/`transform`/`filter` create stacking contexts that trap child `z-index`.
- Don't use `backdrop-filter` on panels layered over animated content; use an opaque background. Animated backdrops cause compositing artifacts and the filter itself creates a stacking-context trap.
- When portalling a Framer Motion element, call `createPortal` on the outside and let `AnimatePresence` directly wrap the `motion` element inside — `AnimatePresence` must be the direct parent of the animating child, or it won't mount/animate.

## Routing & navigation (frontend)

Navigation is **URL-driven** via `react-router-dom` (`app/src/router.tsx`, `createBrowserRouter`). See [ADR 0003](docs/adr/0003-client-side-routing.md) for the full route map.

- The URL is the source of truth for navigation — **not** Zustand. `store/ui.ts` holds UI-only state (command palette, modals + form fields, list filters/search/selection, review edit draft, annotation tool). Never reintroduce navigation fields (`screen`, `activeRunId`, `activeProject`, `activeTicket`, `projectTab`) to the store.
- Run-scoped screens live under `/runs/:runId/*` and read `runId` via `useParams`. Intra-screen *selection* (expanded accordion, selected case/ticket, project tab) goes in **query params** (`?ticket=`, `?case=`, `?tab=`) — not the store, not the path.
- The run WebSocket is owned by `RunLayout` via `RunSocketProvider` (one socket per run visit, persists across intra-run navigation). Screens subscribe to transient events with `useRunEvents(handler)` — don't open `useRunSocket` per screen.
- **Run-scoped screens are reachable only from within a run** (workspace mode — see [ADR 0004](docs/adr/0004-run-workspace-navigation.md)). The global sidebar (`GlobalSidebar`) lists **only** global screens; run-scoped nav (Review/Automation/Execution/Evidence/Link/Publish) lives in the run workspace sidebar (`RunSidebar`) + run-context header (`RunContextHeader`), both shown only under `/runs/:runId/*`.
- **Never default to "the latest run."** For shell chrome, read `useRunRouteId()` (URL-only, returns `null` off run routes) — there is no "resolve current run" fallback (the old `useResolvedRunId` is deleted). `RunLayout` guards every run-scoped route: an invalid or nonexistent `:runId` redirects to `/runs`, never auto-selecting a run.

## Build & verify (app/)

- There is **no unit-test harness**. The gate is `npm run typecheck` (`tsc -b --noEmit`) + `npm run build`. Do not run `npm test` — the script doesn't exist.
- Verify UI/behavior at runtime: `npm run dev` (Vite; auto-falls off 5173 if busy) + Playwright (`playwright` is installed; `npx playwright install chromium` once) to drive real routes and screenshot. The API defaults to `127.0.0.1:8787`; filter benign backend fetch/WebSocket errors when asserting on console output.

## Git / PR workflow

- Default branch is **master** (not `main`). Base PRs on `master`.
- Work on `feature/…` / `docs/…` branches → PR → `gh pr merge <n> --squash --admin --delete-branch`. Auto-merging self-authored PRs with `--admin` is gated by the harness — get the user's authorization once per session before relying on it.
- Worktree caveat: local `--delete-branch` fails with "branch … used by worktree" — harmless; the server-side squash-merge still succeeded (confirm `gh pr view <n> --json state` = `MERGED`). Clean up agent worktrees afterward: `git worktree remove --force <path>` + `git worktree prune`.
- `gh issue create` has no `--json` here (capture the number from the returned URL); pass multi-line issue bodies via `--body-file`, not nested heredocs (they break on apostrophes).
- Secrets stay out of git: `api/.env` and `api/workspace/` are gitignored; only `.env.example` files are tracked.

## Parallel multi-slice work

- For cross-cutting changes, slice into a **solo foundation** + **file-disjoint feature slices run in parallel** (worktree sub-agents), then a **solo cleanup**. Parallelism is bounded by file disjointness, not issue count — slices sharing a core file (store, router, shell) must be sequenced. Pull `master` between waves so each new worktree branches from merged code.
- **Do not use the `de-expert` agent for this project.** Use `general-purpose` for implementation sub-agents.
- When a full migration can't land in one green step, ship a temporary bridge in the foundation so every intermediate slice stays functional and typechecks, then delete the bridge in the cleanup slice.

## Tooling

- In the Bash tool, use bash heredocs for multi-line commit messages; never use PowerShell here-string syntax (`@'...'@`) — it leaks literal characters into the message.
