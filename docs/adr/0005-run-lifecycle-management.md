# ADR 0005 — Run lifecycle management (Cancel / Retry / Delete)

- **Status:** Accepted
- **Date:** 2026-07-08
- **Deciders:** Operator (via in-session decisions), Q-Agent build
- **Extends:** builds on the run pipeline in [ADR 0001](0001-scope-architecture-and-live-integrations.md)

## Context

Run status is a plain `String(32)` (`Run.status`) with a documentary
`RUN_STATUSES` tuple but **no state machine, no transition validation, and no
enforcement** — each pipeline stage assigns `run.status = "…"` directly across
~6 backend files (`ai_service`, `link_service`, `automation`, `execution`,
`playwright_runner`, `runs`). Status is driven automatically by background
daemon **threads** that have no cancellation handle.

Consequences today:

- **No user control.** There is no cancel, retry, or delete — in the API or UI.
  Once a run's threads start, nothing can stop them.
- **Runs never finish.** At runtime a run terminates at `evidence`; `comment`
  and `done` are only ever set by seed data.
- **No timing/terminal metadata.** The `Run` row has only `created_at`.

The client wants to **manage each run's status**. Scope (locked with the
operator): **Cancel**, **Retry**, **Delete** — *not* manual status override,
pause/resume, or a status-history timeline.

## Decision

Introduce a validated status model with terminal states and three
lifecycle operations, backed by a cooperative-cancellation mechanism for the
worker threads. The backend (`api/`) and frontend (`app/`) are file-disjoint
and both build to the HTTP contract defined here.

### 1. Status state machine

Add two terminal statuses. Full set (`RUN_STATUSES` + TS `RunStatus` union):

```
processing → review → sync → automation → executing → evidence → comment → done   (linear pipeline)
                         (any in-progress) → cancelled                              (user cancel)
                         (any in-progress) → failed                                 (worker error)
                              (terminal)    → processing … (resumed stage)          (retry)
```

- **In-progress** = any of `processing, review, sync, automation, executing, evidence, comment`.
- **Terminal** = `{ done, cancelled, failed }`.
- **Invariant:** a **terminal run is never advanced** by a worker. This is what
  makes cancel authoritative — a worker that finishes a stage after the user
  cancelled must not overwrite `cancelled`.

### 2. `set_run_status` — single transition point

All `run.status = …` assignments are replaced by one helper (new, e.g.
`app/services/run_status.py`):

```python
def set_run_status(db: Session, run: Run, new: str) -> bool:
    """Transition a run's status. Returns False (no-op) if the run is already
    terminal — callers in worker threads MUST check this and stop. Stamps
    finished_at on entering a terminal state, writes an audit row, and
    broadcasts the existing `run.status` WS event."""
```

- Rejects/no-ops advancing a terminal run (returns `False`).
- On entering a terminal state, sets `finished_at = utcnow()`.
- Emits `audit_service.record(...)` and `hub.publish(str(run_id), "run.status", {"status": new})` (unchanged WS event name — the frontend already listens for it).

### 3. Data model — new `Run` columns

No migration file: `init_db()` runs `create_all()` + `_sync_columns()`, which
auto-`ALTER`s in new columns. Add (all nullable / defaulted):

| Column | Type | Meaning |
|---|---|---|
| `finished_at` | `UTCDateTime` null | set when a terminal status is entered |
| `cancel_requested` | `bool` default `False` | durable cancel flag (survives thread/session boundaries) |
| `cancelled_at` | `UTCDateTime` null | when cancel was requested |
| `failed_stage` | `String(32)` null | the in-progress status at the moment of failure — the resume point for retry |

### 4. Cooperative cancellation (`app/services/run_control.py`)

In-process registry keyed by `run_id`:

- `request_cancel(run_id)` — set an in-memory `threading.Event` + (caller also sets the DB `cancel_requested`).
- `is_cancelled(run_id, db=None)` — `True` if the event is set **or** the DB `cancel_requested` flag is set (fallback for freshly-loaded rows).
- `register_process(run_id, proc)` / `unregister_process(run_id, proc)` — track live subprocesses/browser handles.
- `kill_processes(run_id)` — terminate all registered processes for a run (mid-case Playwright kill).
- `clear(run_id)` — drop registry entries (on terminal).

**Worker checkpoints** (each bails out *before* advancing status, leaving the
terminal state set by the cancel path):

- `ai_service._run_pipeline` — check `is_cancelled` before each ticket.
- `link_service._worker` — check inside its loop.
- `automation.generate` — check before finalizing the stage.
- `playwright_runner.run_execution` — check between test cases **and** register the browser/subprocess so `kill_processes` can terminate an in-flight case (mid-case cancel).

**Failure handling:** wrap each worker's body so an unhandled exception sets
`failed_stage = <current status>` then `set_run_status(..., "failed")`.

**Close the `done` gap:** when the pipeline reaches its natural end, call
`set_run_status(..., "done")`.

### 5. HTTP API contract (the interface both slices target)

Base path `/runs` (`api/app/routers`). All three write an audit row.

| Method + path | Behavior | Success | Errors |
|---|---|---|---|
| `POST /runs/{id}/cancel` | set `cancel_requested`, signal event, `kill_processes`, `set_run_status → cancelled` | `200` → `RunOut` (status `cancelled`) | `404` unknown; `409` if already terminal |
| `POST /runs/{id}/retry` | resume from `failed_stage` (fallback: run start). Reset `cancel_requested=False`, clear registry, set status to the resume stage, **re-dispatch that stage's worker** | `200` → `RunOut` | `404`; `409` unless terminal |
| `DELETE /runs/{id}` | **hard** cascade delete (see below) | `204` | `404`; `409` if in-progress (**must cancel first**) |

**Retry resume dispatch** — map the resume stage → the worker that produces it,
reusing existing entry points:

| `failed_stage` (resume from) | Re-dispatch |
|---|---|
| `processing` | `ai_service` pipeline (as on create) |
| `review` | back to `processing` (re-run AI gen; `review` is a user-gated stop, nothing to resume) |
| `sync` | `link_service` create+link worker |
| `automation` | `automation` generation |
| `executing` / `evidence` | `playwright_runner` execution |
| `comment` | publish/comment worker |
| null (unknown) | restart from `processing` |

**Hard delete — explicit related-row removal.** SQLite does not enforce
`ondelete` without `PRAGMA foreign_keys=ON`, and `Run` only has an ORM
relationship to `run_tickets`. So the delete **must explicitly** remove related
rows in FK-safe order within one transaction:

- Delete rows in: `executions`, `test_cases`, `reports`, `comments`, `claude_usage` (where `run_id == id`).
- Null out `linked.run_id` (it is `SET NULL` semantics — keep linked work items).
- Delete `run` (its `run_tickets` go via the ORM `delete-orphan` cascade).

### 6. Frontend contract (`app/`)

- **Types** (`types/api.ts`): extend `RunStatus` with `"cancelled" | "failed"`; add `finishedAt?`, `failedStage?` to `RunOut` as the API returns them (camelCase per existing convention).
- **Client** (`lib/api.ts`): `cancelRun(id)`, `retryRun(id)`, `deleteRun(id)`.
- **Hooks** (`hooks/queries.ts`): `useCancelRun`, `useRetryRun`, `useDeleteRun` — invalidate the runs list + the run detail query on success.
- **Status display:** add `cancelled` (gray) and `failed` (red) to the label maps (`screens/Runs.tsx` `RUN_STATUS_LABEL`, `components/dashboard/runStatus.ts` `statusLabel`/`statusColor`). Treat all terminal states (`done`/`cancelled`/`failed`) as **History** in the Runs active-vs-history split (today `status !== "done"`).
- **Controls:** an action menu (`⋯`) on each `RunRow` and in the run header (`RunContextHeader`/`RunDetail`):
  - **Cancel** — shown only for in-progress runs; confirm dialog.
  - **Retry** — shown only for terminal runs.
  - **Delete** — confirm dialog; disabled/blocked for in-progress (surface the `409` as "cancel first").

## Consequences

- **Positive:** cancel is authoritative (terminal-guard invariant); runs now reach
  a true terminal state; retry resumes work rather than redoing it; failures are
  visible (`failed` + `failed_stage`); delete fully cleans up.
- **Cost / risk:** mid-case cancellation depends on tracking live Playwright
  processes — if a handle is missed, cancel degrades to "stops before the next
  case" (acceptable fallback, not silent breakage). The in-memory registry is
  per-process; on API restart, running threads are already dead, and the durable
  `cancel_requested` flag lets a resumed/retried run behave correctly.
- **Deferred (out of scope):** manual status override, pause/resume, and a
  per-run status-change history timeline.

## Slicing

Two file-disjoint slices, run **in parallel** (both target the contract above):

- **Backend** (`api/`) — status model, `set_run_status`, columns, `run_control`,
  worker checkpoints + failure wiring, the three endpoints. Gate: `pytest`.
- **Frontend** (`app/`) — types, client, hooks, status display, action menus.
  Gate: `npm run typecheck` + `npm run build` (no unit-test harness).

Integration (live cancel/retry/delete driven end-to-end) is verified after both merge.
