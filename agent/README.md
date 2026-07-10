# @qagent/agent — Q-Agent Local Agent

Runs Playwright test executions on **your own machine** instead of the
Q-Agent server. This means:

- Manual login / MFA happens in a real, headed browser right where you are
  sitting — not on a headless server.
- Your session cookies/localStorage/sessionStorage **never leave this
  machine**. Only test specs, pass/fail results, and evidence (screenshots/
  video/trace) are sent back to the server.

## Prerequisites

- Node.js 18+

Chromium is installed automatically: the first time you run `qagent-agent start`
the agent downloads Playwright's Chromium if it isn't already present (one-time,
~100 MB, with visible progress). No manual `npx playwright install` step is needed.

## Install & run

```bash
npx @qagent/agent pair <code> --server https://your-qagent-server.example.com/api
npx @qagent/agent start
```

`--server` is the origin serving the API's `/agent/...` routes. On the
same-origin (Cloudflare tunnel) deployment that's `<origin>/api`. In local dev
with the API on its own port, use the API directly (e.g. `http://127.0.0.1:8787`).

Or, if working from a checkout of this package:

```bash
cd agent
npm install
npm run build
node dist/src/cli.js pair <code> --server http://127.0.0.1:8787
node dist/src/cli.js start
```

## Commands

| Command | Description |
| --- | --- |
| `pair <code> [--server <url>] [--name <name>]` | Redeem a one-time pairing code (generated in the Q-Agent SPA's Local Agent screen) for a durable device token. Stored at `~/.qagent-agent/config.json` (mode 0600). |
| `start [--server <url>]` | Long-poll the server for queued `local-agent` executions and run them. Ctrl-C shuts down cleanly, killing any in-flight Playwright/capture process. |
| `status` | Show whether this machine is paired, and to which server. |
| `logout` | Forget the device token. |

## How a job runs

1. Claim a job (`POST /agent/jobs/next`) — spec sources + run params, **never** any session/credentials.
2. Write the specs and a `playwright.config.ts` into a temp workdir.
3. If the project requires manual login and no valid local session exists for
   its origin yet, open a **headed** browser (`vendor/capture_auth.cjs`) for
   you to log in. The captured session is saved under
   `~/.qagent-agent/sessions/<origin>/` and reused on future runs until it
   expires.
4. Run `@playwright/test` headed, parse `report.json`.
5. Push each case's result, its evidence (screenshots/video/trace), and
   progress events back to the server, then mark the job complete.

## Known limitation (flag for the server cleanup phase)

`POST /agent/jobs/next`'s `specs[]` entries currently only carry
`{filename, code}` — not the case's full `ticketExternalId`/`caseCode`
(even though the server has both in scope when building the payload, see
`api/app/routers/agent.py` `claim_next_job`). The agent recovers a
best-effort identity by parsing the `{shortTicket}-{caseCode}.spec.ts`
filename convention (`src/report.ts` `parseSpecIdentity`), assuming the
fixed `TC-NN` case-code format used everywhere else in this codebase. This
only recovers the ticket's **short numeric suffix** (e.g. `"1428"`), not its
full provider-prefixed external id (e.g. `"SUR-1428"`) — so:

- `exec.case.running` / `exec.case.result` WS events carry that short id in
  `ticket`, which may not match what the frontend expects to key rows by.
- `POST /agent/jobs/{id}/evidence` requires an **exact** `ticket_external_id`
  match server-side (`ExecutionResult.ticket_external_id == ticket_external_id`)
  — the short id will likely **not** match, so evidence uploads may 404
  until this is fixed.

The client (`src/api.ts` `JobSpec`, `src/runner.ts` `identityFor`) already
prefers explicit `ticketExternalId`/`caseCode` fields on each spec entry if
present, so the fix is additive: add those two fields to the `specs.append(...)`
call in `claim_next_job` (the loop variable `r` already has them in scope) —
no agent-side change needed once that lands.
