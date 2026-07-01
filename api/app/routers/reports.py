"""Reports router.

Endpoints to implement:
  POST /runs/{run_id}/report      -> ReportOut         (build/refresh from latest execution + Claude failure analysis)
  GET  /runs/{run_id}/report      -> ReportOut
  GET  /reports                   -> list[ReportOut]   (recent, for the Reports screen)
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["reports"])
