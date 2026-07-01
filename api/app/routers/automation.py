"""Automation generation router — Claude -> Playwright TypeScript specs.

Endpoints to implement:
  POST /runs/{run_id}/automation/generate   -> list[AutomationSpecOut]  (approved cases only)
  GET  /runs/{run_id}/automation            -> list[AutomationSpecOut]
  GET  /cases/{case_id}/spec                 -> AutomationSpecOut
  POST /cases/{case_id}/spec/regenerate      -> AutomationSpecOut

Generation writes real *.spec.ts files under workspace/specs/{run_code}/ and
persists AutomationSpec rows. Manual cases are skipped. Publishes WS progress.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["automation"])
