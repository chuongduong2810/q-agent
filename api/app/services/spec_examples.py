"""Few-shot example selection for grounded spec generation.

Picks a small number of *proven* Playwright specs from the SAME project + repo to
show the generator as worked examples. Only specs that actually PASSED at runtime
qualify, so the model learns from code that ran green against the real app — its
conventions, imports, locator strategy and assertion style.

Selection rules (all enforced):

- **Passed only** — the example's latest execution result was ``pass``.
- **Same project + repo** — never cross-project; the example's work item must
  resolve to the given ``project_key`` and its run-ticket repo must equal ``repo``.
- **Never the target itself** — the case we are generating for is excluded, and so
  are drafts / currently-failing specs (they are not in the passed set anyway).
- **Relevance-ranked** — examples are ordered by keyword overlap between the target
  ``case`` (title + steps) and each example's filename + code, so a relevant proven
  spec is preferred over an arbitrary one.

Best-effort and defensive: any resolution error yields ``[]`` rather than raising,
since example selection is an optimization, not a correctness requirement.
"""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from app.logging import logger
from app.models.execution import ExecutionResult
from app.models.run import RunTicket
from app.models.testcase import AutomationSpec, TestCase
from app.models.ticket import Ticket
from app.services import project_config_service

_WORD_RE = re.compile(r"[a-z0-9]+")
# Common English / test-boilerplate words that add noise to overlap scoring.
_STOPWORDS = frozenset(
    {
        "the", "a", "an", "and", "or", "to", "of", "in", "on", "for", "with",
        "is", "are", "be", "should", "test", "case", "page", "user", "when",
        "then", "given", "verify", "check", "that", "this", "as", "it", "from",
    }
)


def _keywords(text: str) -> set[str]:
    """Lowercase alphanumeric tokens of length >= 3, minus stopwords."""
    return {
        w for w in _WORD_RE.findall((text or "").lower())
        if len(w) >= 3 and w not in _STOPWORDS
    }


def _case_keywords(case: Any) -> set[str]:
    """Build the keyword set describing the target case (title + steps)."""
    parts: list[str] = [getattr(case, "title", "") or ""]
    for step in getattr(case, "steps", None) or []:
        if isinstance(step, dict):
            parts.append(step.get("a", ""))
            parts.append(step.get("e", ""))
    return _keywords(" ".join(parts))


def _repo_for_case(db: Session, test_case: TestCase) -> str:
    """Resolve the target repo of a test case via its RunTicket ("" if none)."""
    run_ticket = (
        db.query(RunTicket)
        .filter(
            RunTicket.run_id == test_case.run_id,
            RunTicket.ticket_external_id == test_case.ticket_external_id,
        )
        .first()
    )
    return run_ticket.repo if run_ticket else ""


def _project_key_for_case(db: Session, test_case: TestCase) -> str | None:
    """Resolve the project key a test case belongs to via its ticket's provider."""
    ticket = (
        db.query(Ticket)
        .filter(Ticket.external_id == test_case.ticket_external_id)
        .first()
    )
    if ticket is None:
        return None
    return project_config_service.project_key_for_ticket(db, ticket)


def select_examples(
    db: Session, project_key: str, repo: str, case: Any, limit: int = 2
) -> list[dict]:
    """Return up to ``limit`` proven spec examples for grounded generation.

    Args:
        db: Active session.
        project_key: The resolved project key to scope examples to (same-project only).
        repo: The target repository NAME to scope examples to ("" matches specs whose
            run-ticket repo is also "").
        case: The target :class:`TestCase` (ORM object) we are generating for; its
            own spec is always excluded, and its title/steps drive relevance ranking.
        limit: Max number of examples to return.

    Returns:
        A list of ``{"filename": str, "code": str}`` dicts, ranked by relevance to
        ``case``. Empty when nothing qualifies. Never raises.
    """
    if limit <= 0 or not project_key:
        return []
    try:
        target_case_id = getattr(case, "id", None)
        # Passed execution results joined to their (populated) spec, same-project scope.
        rows = (
            db.query(ExecutionResult.test_case_id, AutomationSpec)
            .join(AutomationSpec, AutomationSpec.test_case_id == ExecutionResult.test_case_id)
            .filter(ExecutionResult.status == "pass")
            .filter(AutomationSpec.code != "")
            .all()
        )

        target_keywords = _case_keywords(case)
        seen_case_ids: set[int] = set()
        candidates: list[tuple[int, dict]] = []  # (score, {filename, code})

        for test_case_id, spec in rows:
            if test_case_id == target_case_id or test_case_id in seen_case_ids:
                continue
            seen_case_ids.add(test_case_id)

            test_case = db.get(TestCase, test_case_id)
            if test_case is None:
                continue
            # Same project + repo only.
            if _repo_for_case(db, test_case) != (repo or ""):
                continue
            if _project_key_for_case(db, test_case) != project_key:
                continue

            example_keywords = _keywords(f"{spec.filename} {test_case.title}")
            score = len(target_keywords & example_keywords)
            candidates.append((score, {"filename": spec.filename, "code": spec.code}))

        # Prefer higher relevance; stable order keeps arbitrary ties deterministic.
        candidates.sort(key=lambda item: item[0], reverse=True)
        return [payload for _, payload in candidates[:limit]]
    except Exception as exc:  # noqa: BLE001 - selection is best-effort
        logger.warning("spec_examples.select_examples failed: {}", exc)
        return []
