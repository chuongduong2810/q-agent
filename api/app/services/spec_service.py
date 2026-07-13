"""Claude -> Playwright TypeScript spec generation.

Prompts the real Claude CLI with a test case's title, precondition, and steps
and asks it to emit a single runnable Playwright + TypeScript spec file. Per
ADR 0001 there is no simulated fallback: failures propagate as ``ClaudeError``.
"""

from __future__ import annotations

import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app.config import settings
from app.logging import logger
from app.models.run import RunTicket
from app.models.testcase import TestCase
from app.models.ticket import Ticket
from app.services import claude_cli, project_config_service
from app.services.prompts import render_project_context
from app.services.skills import AUTOMATION_GENERATOR
from app.services.workspace_scope import scoped_specs_dir

_FENCE_RE = re.compile(r"```(?:ts|typescript)?\s*(.*?)```", re.DOTALL)

# Few-shot reference specs are truncated to keep the prompt small (context-bloat
# guard); at most 1-2 examples are ever injected (see select_examples).
_EXAMPLE_MAX_CHARS = 6000

_SYSTEM_PROMPT = (
    "You are a senior QA automation engineer. You write clean, runnable "
    "Playwright + TypeScript test specs using @playwright/test. Respond with "
    "ONLY the TypeScript source code for a single spec file, wrapped in a "
    "```typescript fenced code block. Do not include any prose before or "
    "after the code block."
)

# Robustness rules shared by generation and self-heal prompts (#178 promotes
# these from the fix-only prompt into generation too, so the FIRST spec is
# already flaky-resistant rather than relying on a heal cycle to fix it).
_ROBUSTNESS_RULES = (
    "Prefer robust locators (getByRole/getByLabel/getByTestId) over brittle raw "
    "CSS/XPath selectors. Use web-first assertions (expect(locator).toBeVisible(), "
    "toHaveText(...), etc.) that rely on Playwright's built-in auto-waiting. Never "
    "use page.waitForTimeout(...) or any other arbitrary hard-coded wait."
)


def _render_examples(examples: list[dict] | None) -> str:
    """Render up to 2 proven passing specs as a reference block for the prompt.

    Args:
        examples: ``[{"filename", "code"}]`` from ``spec_examples.select_examples``
            — real specs that already passed against THIS project + repo. May be
            None/empty.

    Returns:
        A clearly-labelled reference section (each example truncated to
        ``_EXAMPLE_MAX_CHARS``), or "" when there are no usable examples so the
        prompt is unchanged in the no-grounding case.
    """
    if not examples:
        return ""
    blocks: list[str] = []
    for ex in examples[:2]:
        code = (ex.get("code", "") or "")[:_EXAMPLE_MAX_CHARS].strip()
        if not code:
            continue
        filename = ex.get("filename", "") or "spec.ts"
        blocks.append(f"// {filename}\n{code}")
    if not blocks:
        return ""
    return (
        "REFERENCE SPECS — real, already-passing specs from THIS project. Match "
        "their conventions exactly (fixtures, helpers, import structure, assertion "
        "style). Do NOT copy their test logic:\n\n"
        + "\n\n".join(blocks)
        + "\n\n"
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


def _case_rank_query(case: TestCase) -> str:
    """Build the relevance-ranking query text for a case: title + step text.

    Passed as ``render_project_context``'s ``rank_query`` (#182) so the KB's
    routes/selectors are ranked by relevance to what THIS case actually needs
    before being truncated, instead of an arbitrary blind slice.
    """
    parts = [case.title or ""]
    for step in case.steps or []:
        parts.append(step.get("a", ""))
        parts.append(step.get("e", ""))
    return " ".join(parts)


def _build_prompt(
    case: TestCase,
    context: dict[str, Any] | None = None,
    examples: list[dict] | None = None,
    reviewer_comment: str | None = None,
) -> str:
    """Render the Claude prompt for a single test case.

    Args:
        case: The approved, non-Manual TestCase to generate a spec for.
        context: Resolved project context (base URL, real credentials, selectors,
            routes, auth) used to emit a runnable spec with no placeholders.
        examples: Optional few-shot reference specs (proven, already-passing) shown
            so the model matches this project's conventions.
        reviewer_comment: Optional free-text note from a human reviewer steering
            this regeneration. When present it is injected as a high-priority
            guidance block right after the grounding — the caller's gate still
            enforces quality, so the note cannot license placeholders or weaker
            assertions.

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
    project_block = render_project_context(
        context, include_secrets=True, rank_query=_case_rank_query(case)
    )
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
    reviewer_block = (
        (
            "Reviewer guidance — a human reviewer requested this regeneration with "
            "these instructions. Prioritise them, but do NOT use placeholders/invented "
            "values or weaken assertions to satisfy them:\n"
            f"{reviewer_comment[:2000]}\n\n"
        )
        if reviewer_comment
        else ""
    )
    return (
        f"Generate a Playwright TypeScript test spec for this manual test case.\n\n"
        f"{grounding}"
        f"{reviewer_block}"
        f"{_render_examples(examples)}"
        f"Test Case ID: {case.code}\n"
        f"Title: {case.title}\n"
        f"Precondition: {case.precondition or 'None'}\n"
        f"Steps:\n{steps_lines or '  (none provided)'}\n\n"
        f"Use `import {{ test, expect }} from '@playwright/test';` and a single "
        f"`test('{case.code} — {case.title}', async ({{ page }}) => {{ ... }})` block, "
        f"tagged with the Test Case ID ({case.code}) so results trace back to this case, "
        f"that encodes the precondition and each step as page actions/assertions. "
        f"{_ROBUSTNESS_RULES}"
    )


def _build_fix_prompt(
    case: TestCase,
    current_code: str,
    error_message: str,
    run_output: str = "",
    context: dict[str, Any] | None = None,
    examples: list[dict] | None = None,
) -> str:
    """Render a Claude prompt asking it to FIX a spec that failed when executed.

    Args:
        case: The TestCase the spec belongs to (provides the intended behavior).
        current_code: The spec source that just ran and failed — Claude edits this.
        error_message: The failure/assertion error Playwright reported.
        run_output: Optional tail of Playwright stdout/stderr for extra signal.
        context: Resolved project context (base URL, credentials, selectors, …)
            so fixes use the real, grounded values rather than guesses.
        examples: Optional few-shot reference specs (proven, already-passing) so the
            fix keeps this project's conventions.

    Returns:
        A prompt instructing Claude to return the complete corrected spec file.
    """
    steps_lines = "\n".join(
        f"  {i + 1}. Action: {step.get('a', '')} | Expected: {step.get('e', '')}"
        for i, step in enumerate(case.steps or [])
    )
    project_block = render_project_context(
        context, include_secrets=True, rank_query=_case_rank_query(case)
    )
    grounding = f"{project_block}\n\n" if project_block else ""
    output_block = f"\n\nPlaywright output (tail):\n{run_output.strip()[-2000:]}" if run_output.strip() else ""
    return (
        "The following Playwright test FAILED when executed. Fix it so it passes.\n\n"
        f"{grounding}"
        f"{_render_examples(examples)}"
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
    examples: list[dict] | None = None,
) -> str:
    """Ask Claude to repair a failing spec, given its code and the failure.

    Args:
        case: The TestCase the spec automates.
        current_code: The spec source that failed.
        error_message: The Playwright failure/assertion message.
        run_output: Optional tail of the Playwright process output.
        context: Resolved project context for grounded fixes.
        examples: Optional few-shot reference specs (proven, already-passing).

    Returns:
        The corrected TypeScript spec source code.

    Raises:
        claude_cli.ClaudeError: if the CLI is unavailable or errors.
    """
    raw = claude_cli.run_prompt(
        _build_fix_prompt(case, current_code, error_message, run_output, context, examples),
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


def generate_spec_code(
    case: TestCase,
    context: dict[str, Any] | None = None,
    examples: list[dict] | None = None,
    reviewer_comment: str | None = None,
) -> str:
    """Ask Claude to generate Playwright TypeScript source for a test case.

    Args:
        case: The TestCase to generate automation for.
        context: Resolved project context (base URL, credentials, selectors, …)
            so the generated spec runs with little to no manual modification.
        examples: Optional few-shot reference specs (proven, already-passing) shown
            so the generated spec matches this project's conventions.
        reviewer_comment: Optional free-text reviewer note steering a per-case
            regeneration; forwarded into the prompt as guidance (gate unchanged).

    Returns:
        The generated TypeScript spec source code.

    Raises:
        claude_cli.ClaudeError: if the CLI is unavailable or errors.
    """
    raw = claude_cli.run_prompt(
        _build_prompt(case, context, examples, reviewer_comment),
        system=_SYSTEM_PROMPT,
        skill=AUTOMATION_GENERATOR,
        include_template=True,
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


def write_spec_file(
    run_code: str,
    ticket_external_id: str,
    case_code: str,
    code: str,
    owner_id: int | None = None,
) -> Path:
    """Write generated spec source to <scoped specs dir>/{run_code}/{filename}.

    Args:
        run_code: The owning Run's human code, e.g. "RUN-205".
        ticket_external_id: The ticket the case belongs to, e.g. "SUR-1428".
        case_code: The test case's code, e.g. "TC-01".
        code: The TypeScript source to write.
        owner_id: The owning Run's ``owner_id`` (ADR 0009 §1) — resolves the
            per-owner specs tree via ``scoped_specs_dir``; ``None`` (no owner,
            e.g. auth disabled) resolves to the shared namespace.

    Returns:
        The absolute path the file was written to.
    """
    run_dir = scoped_specs_dir(owner_id) / run_code
    run_dir.mkdir(parents=True, exist_ok=True)
    path = run_dir / spec_filename(ticket_external_id, case_code)
    path.write_text(code, encoding="utf-8")
    return path


def _resolve_list_bin() -> str | None:
    """Path to the locally-installed Playwright binary, or None if not installed.

    We deliberately do NOT fall back to ``npx`` here (unlike execution): a bare
    ``npx playwright`` could trigger a network fetch/install and hang, and this
    parse check must never block generation. Absent a local install we skip.
    """
    nm = settings.playwright_node_modules
    for candidate in (nm / ".bin" / "playwright.cmd", nm / ".bin" / "playwright"):
        if candidate.exists():
            return str(candidate)
    return None


def playwright_list_ok(code: str, owner_id: int | None = None) -> bool:
    """Best-effort ``playwright test --list`` parse gate for a generated spec.

    Writes ``code`` to a throwaway spec in a temp dir under the caller's scoped
    specs workspace and runs ``playwright test --list`` against it.

    Args:
        code: The generated Playwright/TypeScript spec source to parse-check.
        owner_id: The owning Run's ``owner_id`` — resolves the scoped specs
            dir the throwaway gate dir is created under (ADR 0009 §1); ``None``
            resolves to the shared namespace.

    Returns:
        ``False`` only when Playwright ran but FAILED to parse/collect the spec (a
        definitive syntax/collection error) — the caller then treats the spec like
        a gate rejection and keeps any previous good spec. Returns ``True`` when the
        spec lists cleanly OR when the check cannot run at all (no local Playwright
        install, timeout, OS error): the check is an optimization and must never
        block generation when it is simply unavailable.
    """
    bin_path = _resolve_list_bin()
    if bin_path is None:
        return True  # skip: nothing to parse with
    try:
        specs_dir = scoped_specs_dir(owner_id)
        specs_dir.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=str(specs_dir)) as tmp:
            tmp_dir = Path(tmp)
            (tmp_dir / "playwright.config.ts").write_text(
                "import { defineConfig } from '@playwright/test';\n"
                "export default defineConfig({ testDir: '.' });\n",
                encoding="utf-8",
            )
            (tmp_dir / "_gate.spec.ts").write_text(code, encoding="utf-8")
            nm = str(settings.playwright_node_modules)
            env = os.environ.copy()
            env["NODE_PATH"] = nm + (
                os.pathsep + env["NODE_PATH"] if env.get("NODE_PATH") else ""
            )
            proc = subprocess.run(  # noqa: S603
                [bin_path, "test", "--list", "_gate.spec.ts"],
                cwd=str(tmp_dir),
                capture_output=True,
                text=True,
                timeout=60,
                shell=True,  # noqa: S602 - .cmd resolution on Windows
                env=env,
            )
            return proc.returncode == 0
    except (OSError, subprocess.SubprocessError) as exc:
        logger.warning("playwright_list_ok skipped ({}): {}", type(exc).__name__, exc)
        return True  # skip on any inability to run
