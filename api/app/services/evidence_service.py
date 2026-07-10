"""Shared evidence persistence — extracted from
``playwright_runner._store_evidence`` (Local Agent feature, #DRY) so both the
server runner (copies files a local Playwright process just wrote) and the
Local Agent's multipart evidence-upload endpoint (``routers/agent.py``) write
evidence through one implementation.
"""

from __future__ import annotations

import shutil
from pathlib import Path

from sqlalchemy.orm import Session

from app.logging import logger
from app.models.execution import Evidence, ExecutionResult
from app.models.run import Run
from app.services.workspace_scope import scoped_evidence_dir


def store_uploaded_evidence(
    db: Session,
    run: Run,
    result: ExecutionResult,
    kind: str,
    src_file_or_bytes: str | Path | bytes | bytearray,
    filename: str,
) -> Evidence | None:
    """Persist one evidence artifact and record its ``Evidence`` row.

    Writes into the run owner's scoped evidence dir (ADR 0009 §1):
    ``scoped_evidence_dir(run.owner_id)/<run.code>/<ticket>/<case>/<filename>``.

    Args:
        db: Active session (the created row is added but not committed — the
            caller commits, matching the rest of this codebase's session
            handling).
        run: The run whose owner scopes the on-disk evidence root.
        result: The ExecutionResult the evidence belongs to.
        kind: Evidence kind (see ``EVIDENCE_KINDS``).
        src_file_or_bytes: Either a filesystem path to copy (the server runner's
            case — a local Playwright process already wrote the file) or raw
            bytes to write directly (the Local Agent's multipart upload case).
        filename: Destination filename (e.g. the original attachment's basename,
            or the uploaded file's name).

    Returns:
        The created (uncommitted) ``Evidence`` row, or ``None`` if a given
        source path does not exist, or the copy/write failed.
    """
    evidence_root = scoped_evidence_dir(run.owner_id)
    dest_dir = evidence_root / run.code / result.ticket_external_id / result.case_code
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / filename

    if isinstance(src_file_or_bytes, (bytes, bytearray)):
        try:
            dest.write_bytes(bytes(src_file_or_bytes))
        except OSError as exc:
            logger.warning("Failed to write evidence {}: {}", dest, exc)
            return None
    else:
        src = Path(src_file_or_bytes)
        if not src.exists():
            return None
        try:
            shutil.copy2(src, dest)
        except OSError as exc:
            logger.warning("Failed to copy evidence {}: {}", src, exc)
            return None

    rel_path = dest.relative_to(evidence_root).as_posix()
    evidence = Evidence(
        result_id=result.id,
        kind=kind,
        path=rel_path,
        filename=dest.name,
        size_bytes=dest.stat().st_size,
    )
    db.add(evidence)
    return evidence
