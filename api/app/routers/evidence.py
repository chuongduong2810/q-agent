"""Evidence + screenshot annotation router.

Endpoints to implement:
  GET  /runs/{run_id}/evidence                 -> {tickets: [...], byTicket: {...}}  (grouped by ticket)
  GET  /results/{result_id}/evidence           -> list[EvidenceOut]
  POST /evidence/{evidence_id}/annotate         -> EvidenceOut   (AnnotateRequest; Pillow burns shapes)

Artifacts are served under /artifacts/... (StaticFiles). Annotation writes a new
annotated PNG next to the original and flips Evidence.annotated.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["evidence"])
