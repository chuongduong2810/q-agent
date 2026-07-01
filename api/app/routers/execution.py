"""Execution router — run the approved Playwright suite for a Run.

Endpoints to implement:
  POST /runs/{run_id}/execution        -> ExecutionOut   (start; body ExecutionStart; async)
  GET  /runs/{run_id}/execution        -> ExecutionOut   (latest execution + results)
  GET  /executions/{execution_id}      -> ExecutionOut

Spawns Playwright (real) against workspace/specs, streams per-case status via WS
(events: exec.case.running / exec.case.result / exec.progress / exec.done),
records ExecutionResult + Evidence rows, advances Run.status executing→evidence.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["execution"])
