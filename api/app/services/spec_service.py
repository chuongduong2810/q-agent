"""Claude -> Playwright TypeScript spec generation.

Prompts the real Claude CLI with a test case's title, precondition, and steps
and asks it to emit a single runnable Playwright + TypeScript spec file. Per
ADR 0001 there is no simulated fallback: failures propagate as ``ClaudeError``.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.models.run import RunTicket
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.services import claude_cli, project_config_service
from app.services.prompts import render_project_context
from app.services.skills import AUTOMATION_GENERATOR

_FENCE_RE = re.compile(r"```(?:ts|typescript)?\s*(.*?)```", re.DOTALL)

_SYSTEM_PROMPT = (
    "You are a senior QA automation engineer. You write clean, runnable "
    "Playwright + TypeScript test specs using @playwright/test. Respond with "
    "ONLY the TypeScript source code for a single spec file, wrapped in a "
    "```typescript fenced code block. Do not include any prose before or "
    "after the code block."
)


def build_case_context(db: Session, case: TestCase, env: str = "") -> dict[str, Any]:
    """Resolve the Project Knowledge Base + config for a test case's project.

    Looks up the case's ticket to find its provider, then resolves the full
    project context (base URL, decrypted test-account credentials, routes,
    selectors, auth flow, reusable assets). Returns an empty-ish dict when no
    project resolves — generation still works, just without grounding.
    """
    ticket = db.query(Ticket).filter(Ticket.external_id == case.ticket_external_id).first()
    if ticket is None:
        return {}
    # Resolve the work item's chosen target repo so the spec is generated against
    # that repo's knowledge base (falls back to the project default when empty).
    run_ticket = (
        db.query(RunTicket)
        .filter(
            RunTicket.run_id == case.run_id,
            RunTicket.ticket_external_id == case.ticket_external_id,
        )
        .first()
    )
    repo = run_ticket.repo if run_ticket else ""
    return project_config_service.context_for_ticket(db, ticket, env=env, repo=repo)


def _build_prompt(case: TestCase, context: dict[str, Any] | None = None) -> str:
    """Render the Claude prompt for a single test case.

    Args:
        case: The approved, non-Manual TestCase to generate a spec for.
        context: Resolved project context (base URL, real credentials, selectors,
            routes, auth) used to emit a runnable spec with no placeholders.

    Returns:
        A prompt string describing the case's title, precondition, and steps,
        instructing Claude to produce a Playwright TS spec.
    """
    steps_lines = "\n".join(
        f"  {i + 1}. Action: {step.get('a', '')} | Expected: {step.get('e', '')}"
        for i, step in enumerate(case.steps or [])
    )
    # include_secrets=True: the user chose to bake literal credentials/URLs into
    # generated specs so they run unmodified.
    project_block = render_project_context(context, include_secrets=True)
    if project_block:
        grounding = (
            f"{project_block}\n\n"
            "Use the real values above DIRECTLY in the spec: navigate to the real "
            "base URL / routes, log in with the real credentials, and use the real "
            "selectors and locator strategy. Only fall back to a clearly-marked "
            "// TODO placeholder for a value that is genuinely absent from the "
            "context above.\n\n"
        )
    else:
        grounding = (
            "If a concrete URL or selector isn't known, use reasonable placeholders "
            "and TODO comments rather than inventing unrelated behavior.\n\n"
        )
    return (
        f"Generate a Playwright TypeScript test spec for this manual test case.\n\n"
        f"{grounding}"
        f"Title: {case.title}\n"
        f"Precondition: {case.precondition or 'None'}\n"
        f"Steps:\n{steps_lines or '  (none provided)'}\n\n"
        f"Use `import {{ test, expect }} from '@playwright/test';` and a single "
        f"`test('{case.title}', async ({{ page }}) => {{ ... }})` block that "
        f"encodes the precondition and each step as page actions/assertions."
    )


def _build_fix_prompt(
    case: TestCase,
    current_code: str,
    error_message: str,
    run_output: str = "",
    context: dict[str, Any] | None = None,
) -> str:
    """Render a Claude prompt asking it to FIX a spec that failed when executed.

    Args:
        case: The TestCase the spec belongs to (provides the intended behavior).
        current_code: The spec source that just ran and failed — Claude edits this.
        error_message: The failure/assertion error Playwright reported.
        run_output: Optional tail of Playwright stdout/stderr for extra signal.
        context: Resolved project context (base URL, credentials, selectors, …)
            so fixes use the real, grounded values rather than guesses.

    Returns:
        A prompt instructing Claude to return the complete corrected spec file.
    """
    steps_lines = "\n".join(
        f"  {i + 1}. Action: {step.get('a', '')} | Expected: {step.get('e', '')}"
        for i, step in enumerate(case.steps or [])
    )
    project_block = render_project_context(context, include_secrets=True)
    grounding = f"{project_block}\n\n" if project_block else ""
    output_block = f"\n\nPlaywright output (tail):\n{run_output.strip()[-2000:]}" if run_output.strip() else ""
    return (
        "The following Playwright test FAILED when executed. Fix it so it passes.\n\n"
        f"{grounding}"
        f"Test case being automated:\n"
        f"Title: {case.title}\n"
        f"Precondition: {case.precondition or 'None'}\n"
        f"Steps:\n{steps_lines or '  (none provided)'}\n\n"
        "Current spec (this is exactly what ran and FAILED):\n"
        f"```typescript\n{current_code.strip()}\n```\n\n"
        f"Failure / error:\n{error_message.strip() or '(no error message captured)'}"
        f"{output_block}\n\n"
        "Return the COMPLETE corrected spec file (full source, not a diff). Keep the "
        f"same `test('{case.title}', ...)` title. Address the specific failure above: "
        "fix broken selectors, missing awaits, wrong routes/URLs, timing, or "
        "assertions. Prefer robust locators (getByRole/getByLabel/getByText), "
        "web-first assertions (expect(locator).toBeVisible(), etc.), and explicit "
        "waits over arbitrary timeouts. Use the real grounded values above where "
        "given. Do not invent unrelated behavior or weaken the test just to pass."
    )


def generate_fixed_spec_code(
    case: TestCase,
    current_code: str,
    error_message: str,
    run_output: str = "",
    context: dict[str, Any] | None = None,
) -> str:
    """Ask Claude to repair a failing spec, given its code and the failure.

    Args:
        case: The TestCase the spec automates.
        current_code: The spec source that failed.
        error_message: The Playwright failure/assertion message.
        run_output: Optional tail of the Playwright process output.
        context: Resolved project context for grounded fixes.

    Returns:
        The corrected TypeScript spec source code.

    Raises:
        claude_cli.ClaudeError: if the CLI is unavailable or errors.
    """
    raw = claude_cli.run_prompt(
        _build_fix_prompt(case, current_code, error_message, run_output, context),
        system=_SYSTEM_PROMPT,
        skill=AUTOMATION_GENERATOR,
        label=f"Heal: {case.ticket_external_id} {case.code}",
    )
    return _extract_code(raw)


def _extract_code(raw: str) -> str:
    """Pull TypeScript source out of Claude's response.

    Args:
        raw: The raw text returned by the Claude CLI, expected to contain a
            fenced ```typescript code block.

    Returns:
        The extracted source code, or the raw text stripped if no fence is
        present (defensive — Claude is instructed to always fence).
    """
    match = _FENCE_RE.search(raw)
    return (match.group(1) if match else raw).strip() + "\n"


def generate_spec_code(case: TestCase, context: dict[str, Any] | None = None) -> str:
    """Ask Claude to generate Playwright TypeScript source for a test case.

    Args:
        case: The TestCase to generate automation for.
        context: Resolved project context (base URL, credentials, selectors, …)
            so the generated spec runs with little to no manual modification.

    Returns:
        The generated TypeScript spec source code.

    Raises:
        claude_cli.ClaudeError: if the CLI is unavailable or errors.
    """
    raw = claude_cli.run_prompt(
        _build_prompt(case, context),
        system=_SYSTEM_PROMPT,
        skill=AUTOMATION_GENERATOR,
        label=f"Spec: {case.ticket_external_id} {case.code}",
    )
    return _extract_code(raw)


def spec_filename(ticket_external_id: str, case_code: str) -> str:
    """Build the on-disk spec filename for a case.

    Args:
        ticket_external_id: e.g. "SUR-1428".
        case_code: e.g. "TC-01".

    Returns:
        A filename like "1428-TC-01.spec.ts" (ticket prefix stripped to the
        numeric/short suffix after the last '-', kept simple and unique per run).
    """
    short_ticket = ticket_external_id.rsplit("-", 1)[-1]
    return f"{short_ticket}-{case_code}.spec.ts"


def write_spec_file(run_code: str, ticket_external_id: str, case_code: str, code: str) -> Path:
    """Write generated spec source to workspace/specs/{run_code}/{filename}.

    Args:
        run_code: The owning Run's human code, e.g. "RUN-205".
        ticket_external_id: The ticket the case belongs to, e.g. "SUR-1428".
        case_code: The test case's code, e.g. "TC-01".
        code: The TypeScript source to write.

    Returns:
        The absolute path the file was written to.
    """
    run_dir = settings.specs_dir / run_code
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / spec_filename(ticket_external_id, case_code)
    path.write_text(code, encoding="utf-8")
    return path
