"""Claude -> Playwright TypeScript spec generation.

Prompts the real Claude CLI with a test case's title, precondition, and steps
and asks it to emit a single runnable Playwright + TypeScript spec file. Per
ADR 0001 there is no simulated fallback: failures propagate as ``ClaudeError``.
"""

from __future__ import annotations

import re
from pathlib import Path

from app.config import settings
from app.models.testcase import TestCase
from app.services import claude_cli
from app.services.skills import AUTOMATION_GENERATOR

_FENCE_RE = re.compile(r"```(?:ts|typescript)?\s*(.*?)```", re.DOTALL)

_SYSTEM_PROMPT = (
    "You are a senior QA automation engineer. You write clean, runnable "
    "Playwright + TypeScript test specs using @playwright/test. Respond with "
    "ONLY the TypeScript source code for a single spec file, wrapped in a "
    "```typescript fenced code block. Do not include any prose before or "
    "after the code block."
)


def _build_prompt(case: TestCase) -> str:
    """Render the Claude prompt for a single test case.

    Args:
        case: The approved, non-Manual TestCase to generate a spec for.

    Returns:
        A prompt string describing the case's title, precondition, and steps,
        instructing Claude to produce a Playwright TS spec.
    """
    steps_lines = "\n".join(
        f"  {i + 1}. Action: {step.get('a', '')} | Expected: {step.get('e', '')}"
        for i, step in enumerate(case.steps or [])
    )
    return (
        f"Generate a Playwright TypeScript test spec for this manual test case.\n\n"
        f"Title: {case.title}\n"
        f"Precondition: {case.precondition or 'None'}\n"
        f"Steps:\n{steps_lines or '  (none provided)'}\n\n"
        f"Use `import {{ test, expect }} from '@playwright/test';` and a single "
        f"`test('{case.title}', async ({{ page }}) => {{ ... }})` block that "
        f"encodes the precondition and each step as page actions/assertions. "
        f"If a concrete URL or selector isn't known, use reasonable placeholders "
        f"and TODO comments rather than inventing unrelated behavior."
    )


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


def generate_spec_code(case: TestCase) -> str:
    """Ask Claude to generate Playwright TypeScript source for a test case.

    Args:
        case: The TestCase to generate automation for.

    Returns:
        The generated TypeScript spec source code.

    Raises:
        claude_cli.ClaudeError: if the CLI is unavailable or errors.
    """
    raw = claude_cli.run_prompt(
        _build_prompt(case), system=_SYSTEM_PROMPT, skill=AUTOMATION_GENERATOR
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
