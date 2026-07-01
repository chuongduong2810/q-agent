"""Runs + AI analysis + test-case generation router.

Endpoints to implement:
  GET  /runs                      -> list[RunOut]
  POST /runs                      -> RunDetailOut     (body: RunCreate; kicks off async AI pipeline)
  GET  /runs/{run_id}             -> RunDetailOut
  GET  /runs/{run_id}/tickets     -> list[RunTicketOut]  (per-ticket analysis + gen status)
  POST /runs/{run_id}/regenerate  -> RunDetailOut     (re-run analysis/generation)

On create: for each ticket -> Claude analyze (business rules, risks, edge cases…)
-> Claude generate ADO-style test cases -> persist TestCase rows -> advance
Run.status processing→review. Publish WS progress events per ticket/phase.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/runs", tags=["runs"])
