"""Projects router.

Endpoints to implement:
  GET  /projects                 -> list[ProjectOut]
  POST /projects/refresh          -> list[ProjectOut]   (pull projects from connected providers)
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(prefix="/projects", tags=["projects"])
