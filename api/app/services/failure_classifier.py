"""Classify a failed Playwright test by root cause.

When a spec fails at runtime we want to know *why* before we act: a **test
defect** (bad selector / stale expectation) should be healed by regenerating the
spec, whereas a **product defect** (the app is actually wrong) should become a
ticket — never "fixed" by weakening the test. This module asks Claude, guided by
the ``execution-analyzer`` skill's taxonomy, to make that call from the case
intent, the spec, the failure, and the project grounding.

It mirrors :func:`app.services.evidence_analysis._analyze`: build a JSON-output
prompt, call :func:`claude_cli.run_json` with the dedicated skill, and coerce the
reply into a fixed shape.

Fail-safe: on ANY error or unparseable reply it returns a safe default that
classifies the failure as ``test_defect`` (``suspectedProductDefect=False``). We
fail *toward* "test defect" on purpose — the downstream anti-cheat assertion guard
(a later slice) is the real safety net against a heal that weakens the test, so a
missed product-defect signal here is recoverable, whereas over-reporting product
defects would create noise.
"""

from __future__ import annotations

from typing import Any

from app.logging import logger
from app.services import claude_cli
from app.services.prompts import render_project_context
from app.services.skills import EXECUTION_ANALYZER

# Valid failure classes the model may return (mirrors FAILURE_CLASSES minus "").
_VALID_CLASSES = ("test_defect", "product_defect", "flaky", "environment", "timeout")

_SAFE_DEFAULT: dict[str, Any] = {
    "failureClass": "test_defect",
    "suspectedProductDefect": False,
    "reason": "classification unavailable",
}

_JSON_SHAPE = (
    '{"failureClass":"test_defect|product_defect|flaky|environment|timeout",'
    '"suspectedProductDefect":true|false,'
    '"reason":"<=300 char evidence-based justification"}'
)


def _build_prompt(
    case: Any, spec_code: str, error: str, output: str, context: dict | None
) -> str:
    """Compose the classification prompt (case intent + spec + failure + grounding)."""
    steps_lines = "\n".join(
        f"  {i + 1}. Action: {step.get('a', '')} | Expected: {step.get('e', '')}"
        for i, step in enumerate(getattr(case, "steps", None) or [])
        if isinstance(step, dict)
    )
    project_block = render_project_context(context)
    grounding = f"{project_block}\n\n" if project_block else ""
    output_tail = (output or "").strip()[-2000:]
    output_block = f"\n\nPlaywright output (tail):\n{output_tail}" if output_tail else ""

    return (
        "A Playwright end-to-end UI test FAILED. Classify the failure's root cause "
        "using the execution-analyzer taxonomy: test_defect (the test is wrong — bad "
        "selector, stale expectation, wrong data), product_defect (the app behaved "
        "incorrectly — assertion on a real business value failed, page errored, UI "
        "contradicts the acceptance criteria), flaky (passes on retry / timing race), "
        "environment (infra or data preconditions — service down, auth expired, wrong "
        "base URL, missing seed), or timeout (action/assertion timed out — decide if "
        "genuine slowness vs. a test issue).\n\n"
        f"{grounding}"
        f"Test case intent:\n"
        f"Title: {getattr(case, 'title', '') or '(untitled)'}\n"
        f"Precondition: {getattr(case, 'precondition', '') or 'None'}\n"
        f"Steps:\n{steps_lines or '  (none provided)'}\n\n"
        "Spec that ran and failed:\n"
        f"```typescript\n{(spec_code or '').strip()}\n```\n\n"
        f"Failure / error:\n{(error or '(no error message captured)').strip()}"
        f"{output_block}\n\n"
        "Base your classification on the concrete evidence above. Set "
        "\"suspectedProductDefect\" to true only when the evidence points to the app "
        "being wrong (not the test).\n\n"
        f"Respond with ONLY a JSON object of this exact shape:\n{_JSON_SHAPE}"
    )


def classify_failure(
    case: Any,
    spec_code: str,
    error: str,
    output: str,
    context: dict | None,
) -> dict:
    """Classify a failed test's root cause via Claude (execution-analyzer skill).

    Args:
        case: The :class:`TestCase` being automated (provides intent: title,
            precondition, steps).
        spec_code: The spec source that ran and failed.
        error: The Playwright failure / assertion message.
        output: The Playwright process output (a tail is included for context).
        context: The resolved project grounding (from
            ``project_config_service.build_context``), or None.

    Returns:
        A dict ``{"failureClass": str, "suspectedProductDefect": bool,
        "reason": str}`` where ``failureClass`` is one of test_defect /
        product_defect / flaky / environment / timeout. On ANY error or
        unparseable reply, returns the safe default (``test_defect``,
        ``suspectedProductDefect=False``, reason "classification unavailable").
    """
    try:
        data = claude_cli.run_json(
            _build_prompt(case, spec_code, error, output, context),
            skill=EXECUTION_ANALYZER,
            label=f"Classify: {getattr(case, 'ticket_external_id', '')} {getattr(case, 'code', '')}",
        )
    except Exception as exc:  # noqa: BLE001 - fail toward test_defect
        logger.warning("failure_classifier: Claude call failed: {}", exc)
        return dict(_SAFE_DEFAULT)

    if not isinstance(data, dict):
        return dict(_SAFE_DEFAULT)

    failure_class = str(data.get("failureClass", "")).strip().lower()
    if failure_class not in _VALID_CLASSES:
        return dict(_SAFE_DEFAULT)

    suspected = bool(data.get("suspectedProductDefect", False))
    # Keep the signal internally consistent: a product_defect implies suspicion.
    if failure_class == "product_defect":
        suspected = True
    reason = str(data.get("reason", "")).strip()[:400] or "classification unavailable"

    return {
        "failureClass": failure_class,
        "suspectedProductDefect": suspected,
        "reason": reason,
    }
