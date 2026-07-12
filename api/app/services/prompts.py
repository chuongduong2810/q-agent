"""Prompt builders for the Claude CLI calls used by the AI pipeline.

Each builder returns a single prompt string that instructs Claude to respond
with strict JSON matching the shape the caller (``app.services.ai_service``)
will parse. Keeping the prompts here (rather than inline) makes the expected
JSON contracts easy to find and change in one place.
"""

from __future__ import annotations

from typing import Any

from app.models.ticket import Ticket

ANALYSIS_JSON_SHAPE = """{
  "businessRules": string[],
  "functionalRequirements": string[],
  "validationRules": string[],
  "risks": string[],
  "edgeCases": string[],
  "missingInformation": string[],
  "suggestedScope": string,
  "suggestedRepo": string
}"""

CASES_JSON_SHAPE = """[
  {
    "title": string,
    "objective": string,
    "precondition": string,
    "testData": [ { "field": string, "value": string } ],
    "steps": [ { "a": string, "e": string } ],
    "linkedAc": string[],
    "priority": "High" | "Medium" | "Low",
    "testType": string,
    "automation": "Playwright" | "Selenium" | "Cypress" | "Manual",
    "platform": string
  }
]"""

CASE_JSON_SHAPE = """{
  "title": string,
  "objective": string,
  "precondition": string,
  "testData": [ { "field": string, "value": string } ],
  "steps": [ { "a": string, "e": string } ],
  "linkedAc": string[],
  "priority": "High" | "Medium" | "Low",
  "testType": string,
  "automation": "Playwright" | "Selenium" | "Cypress" | "Manual",
  "platform": string
}"""

REVIEW_JSON_SHAPE = """{
  "verdict": "approve" | "approve-with-changes" | "reject",
  "coverageGaps": string[],
  "additionalCases": [
    {
      "title": string,
      "objective": string,
      "precondition": string,
      "testData": [ { "field": string, "value": string } ],
      "steps": [ { "a": string, "e": string } ],
      "linkedAc": string[],
      "priority": "High" | "Medium" | "Low",
      "testType": string,
      "automation": "Playwright" | "Selenium" | "Cypress" | "Manual",
      "platform": string
    }
  ]
}"""


def _ticket_context(ticket: Ticket) -> str:
    """Render the ticket fields Claude needs: title, description, acceptance criteria."""
    ac = "\n".join(f"- {item}" for item in (ticket.acceptance_criteria or [])) or "(none provided)"
    return (
        f"Ticket {ticket.external_id}: {ticket.title}\n\n"
        f"Description:\n{ticket.description or '(none provided)'}\n\n"
        f"Acceptance Criteria:\n{ac}"
    )


def render_project_context(context: dict[str, Any] | None, *, include_secrets: bool = False) -> str:
    """Render the resolved Project Knowledge Base + config for a prompt.

    This is the shared project grounding that lets downstream skills reuse real
    domain terminology, routes, selectors, auth, and (for automation) concrete
    URLs and credentials instead of inventing placeholders.

    Args:
        context: Output of ``project_config_service.build_context`` (or None).
        include_secrets: When True, test-account passwords are included verbatim
            (used ONLY by automation generation, per the "literal values" choice).
            When False, only roles/usernames are shown.

    Returns:
        A markdown block, or an empty string when there is no project context.
    """
    if not context or not context.get("projectKey"):
        return ""

    lines = ["Project context (from the Project Knowledge Base — reuse this, do not invent):"]
    if context.get("baseUrl"):
        lines.append(f"- Base URL: {context['baseUrl']}")
    if context.get("domain"):
        lines.append(f"- Business domain: {context['domain']}")
    if context.get("architecture"):
        lines.append(f"- Architecture: {context['architecture']}")
    if context.get("businessEntities"):
        lines.append(f"- Business entities: {', '.join(context['businessEntities'])}")
    if context.get("locator"):
        lines.append(f"- Locator strategy: {context['locator']}")

    routes = context.get("routes") or []
    if routes:
        rendered = "; ".join(
            f"{r.get('path', '')} ({r.get('description', '')})" for r in routes[:20]
        )
        lines.append(f"- Application routes: {rendered}")

    selectors = context.get("selectors") or []
    if selectors:
        rendered = "; ".join(
            f"{s.get('screen', '')}:{s.get('element', '')}=`{s.get('selector', '')}`"
            for s in selectors[:30]
        )
        lines.append(f"- Known selectors: {rendered}")

    auth = context.get("auth") or {}
    if auth.get("login_flow") or auth.get("login_url"):
        lines.append(
            f"- Auth: {auth.get('login_flow', '')} "
            f"(login URL: {auth.get('login_url', '—')}, "
            f"storageState: {auth.get('storage_state', '—')})"
        )

    for label, key in (("Page objects", "pageObjectNames"), ("Fixtures", "fixtureNames"),
                       ("Utilities", "utilities")):
        vals = context.get(key) or []
        if vals:
            lines.append(f"- {label} to reuse: {', '.join(vals)}")

    accounts = context.get("testAccounts") or []
    if accounts:
        if include_secrets:
            rendered = "; ".join(
                f"{a.get('role', 'account')}: username=`{a.get('username', '')}` "
                f"password=`{a.get('password', '')}`"
                for a in accounts
            )
            lines.append(f"- Test accounts (use these real credentials directly): {rendered}")
        else:
            rendered = "; ".join(
                f"{a.get('role', 'account')} ({a.get('username', '')})" for a in accounts
            )
            lines.append(f"- Test-account roles available: {rendered}")

    return "\n".join(lines)


def build_analysis_prompt(ticket: Ticket, context: dict[str, Any] | None = None) -> str:
    """Prompt asking Claude to analyze a ticket's requirements.

    Returns a JSON object with businessRules, functionalRequirements,
    validationRules, risks, edgeCases, missingInformation, suggestedScope.
    ``context`` is the resolved Project Knowledge Base so the analysis reuses real
    domain terms, workflows and entities instead of reinterpreting them.
    """
    project_block = render_project_context(context)
    project_section = f"{project_block}\n\n" if project_block else ""

    repo_options = (context or {}).get("repoOptions") or []
    if repo_options:
        repo_lines = "\n".join(
            f"- {opt.get('name', '')}"
            + (f" (hint: {opt['hint']})" if opt.get("hint") else "")
            for opt in repo_options
            if opt.get("name")
        )
        repo_section = (
            "The project has these repositories. Decide which single one this work "
            "item most likely targets and set \"suggestedRepo\" to that repo NAME "
            "exactly as written below (or \"\" if you are unsure):\n"
            f"{repo_lines}\n\n"
        )
    else:
        repo_section = ""

    return (
        "You are a senior QA analyst. Analyze the following work item and extract "
        "the information a QA engineer needs before writing manual test cases.\n\n"
        f"{project_section}"
        f"{repo_section}"
        f"{_ticket_context(ticket)}\n\n"
        "Identify: business rules implied by the requirements, functional "
        "requirements, validation rules (input constraints, formats, boundaries), "
        "risks (things likely to break or be misunderstood), edge cases worth "
        "testing, any missing information that should be clarified with the "
        "author, a one-sentence suggested test scope, and the single most likely "
        "target repository name (suggestedRepo).\n\n"
        f"Respond with ONLY a JSON object of this exact shape:\n{ANALYSIS_JSON_SHAPE}"
    )


def build_generation_prompt(
    ticket: Ticket, analysis: dict, max_cases: int = 8, context: dict[str, Any] | None = None
) -> str:
    """Prompt asking Claude to generate the baseline happy-path test cases.

    This is the FIRST of a two-stage design (see the ``test-case-generator``
    skill v2): it produces a small, review-friendly set covering the PRIMARY
    successful flow of each acceptance criterion. Edge, negative, boundary,
    permission and error-handling coverage is deliberately deferred to the
    ``test-case-reviewer`` stage, so this prompt must NOT ask for it (that
    contradiction is exactly what made coverage depth nondeterministic).

    Returns a JSON array of case objects (title, precondition, steps, priority,
    testType, automation, platform). ``max_cases`` caps how many are generated.
    ``context`` is the resolved Project Knowledge Base so preconditions and steps
    reference real screens, routes and account roles.
    """
    project_block = render_project_context(context)
    project_section = f"{project_block}\n\n" if project_block else ""
    return (
        "You are a senior QA engineer. Using the ticket and the prior requirement "
        "analysis below, write a lightweight, review-friendly set of ADO-style "
        "manual test cases that prove the feature works end-to-end.\n\n"
        "Cover ONLY the primary successful flow (happy path) — aim for one "
        "successful scenario per acceptance criterion, merging near-duplicate "
        "journeys. Do NOT generate negative, invalid-input, boundary, permission, "
        "empty-state or error-handling cases: those are added later in a separate "
        "review stage, so leaving them out here is correct, not incomplete.\n\n"
        f"Generate AT MOST {max_cases} test cases — prioritise the highest-value "
        "happy-path coverage if you would otherwise exceed that.\n\n"
        f"{project_section}"
        f"{_ticket_context(ticket)}\n\n"
        f"Prior analysis (JSON):\n{analysis}\n\n"
        "Each test case must have: a clear title; a one-line objective (what the "
        "case proves); a precondition; any test data it needs as testData "
        "[{field, value}] pairs; a list of steps where each step has an action "
        "(a) and expected result (e); linkedAc — the acceptance criteria this "
        "case covers, quoted or identified from the ticket; a priority "
        "(High/Medium/Low); a testType (typically 'Functional' for these "
        "primary-flow cases); an automation type "
        "(Playwright/Selenium/Cypress/Manual); and a platform (e.g. Web).\n\n"
        "Automation type: DEFAULT to 'Playwright' for web UI and functional cases "
        "that a browser can drive (navigation, forms, validation, CRUD, permissions). "
        "Only use 'Manual' when a case genuinely cannot be automated reliably — e.g. "
        "exploratory testing, subjective visual judgement, external email/SMS delivery, "
        "or time/scheduler-dependent behavior. Do not mark a whole feature Manual by default.\n\n"
        f"Respond with ONLY a JSON array of this exact shape:\n{CASES_JSON_SHAPE}"
    )


def build_review_prompt(
    ticket: Ticket,
    analysis: dict,
    existing_cases: list[dict],
    max_cases: int = 8,
    context: dict[str, Any] | None = None,
) -> str:
    """Prompt for the second stage: review the happy-path set and fill coverage gaps.

    The ``test-case-generator`` stage intentionally produces only the primary
    successful flow per acceptance criterion (see :func:`build_generation_prompt`).
    This stage asks the reviewer to audit that set against the requirement
    analysis and then GENERATE the deferred coverage — negative, invalid-input,
    boundary, permission, empty-state and error-handling cases — that fill the
    gaps, without duplicating the existing happy-path cases.

    Returns a JSON object with ``verdict``, ``coverageGaps`` (ACs/business rules
    not yet covered) and ``additionalCases`` (new cases in the standard case
    shape). ``max_cases`` caps how many additional cases to add.
    """
    project_block = render_project_context(context)
    project_section = f"{project_block}\n\n" if project_block else ""
    return (
        "You are a senior QA reviewer. The happy-path test cases below were "
        "generated to cover the PRIMARY successful flow of each acceptance "
        "criterion only; edge, negative, boundary, permission, empty-state and "
        "error-handling coverage was deliberately deferred to you.\n\n"
        "Review the existing cases against the ticket and the prior requirement "
        "analysis, then:\n"
        "1. List the concrete coverage gaps (acceptance criteria, business rules, "
        "validation rules, risks and edge cases from the analysis that the "
        "happy-path set does not yet exercise).\n"
        f"2. GENERATE AT MOST {max_cases} additional test cases that fill those "
        "gaps — negative, invalid-input, boundary, permission and error-handling "
        "scenarios. Do NOT duplicate or restate the existing happy-path cases.\n"
        "3. Give an overall verdict.\n\n"
        f"{project_section}"
        f"{_ticket_context(ticket)}\n\n"
        f"Prior analysis (JSON):\n{analysis}\n\n"
        f"Existing happy-path cases (JSON):\n{existing_cases}\n\n"
        "Each additional case uses the same fields as the existing cases: title, "
        "objective, precondition, testData ([{field, value}]), steps ([{a, e}]), "
        "linkedAc (the acceptance criteria it covers), priority (High/Medium/Low), "
        "testType (e.g. Negative, Boundary, Security, Permission), automation "
        "(Playwright/Selenium/Cypress/Manual), and platform (e.g. Web).\n\n"
        f"Respond with ONLY a JSON object of this exact shape:\n{REVIEW_JSON_SHAPE}"
    )


def build_case_regenerate_prompt(
    ticket: Ticket, analysis: dict, existing_case: dict, context: dict[str, Any] | None = None
) -> str:
    """Prompt asking Claude to regenerate a single test case, keeping its intent/code.

    ``context`` is the resolved Project Knowledge Base — passed so the rewrite
    reuses real routes, roles and selectors instead of inventing them (#183),
    matching :func:`build_generation_prompt`.

    Returns a JSON object with the same shape as one entry from
    ``build_generation_prompt``'s array.
    """
    project_block = render_project_context(context)
    project_section = f"{project_block}\n\n" if project_block else ""
    return (
        "You are a senior QA engineer. Rewrite/improve the single test case below "
        "for the given ticket, using the prior requirement analysis for context. "
        "Keep it focused on the same testing intent and scope, but improve its "
        "clarity and correctness.\n\n"
        f"{project_section}"
        f"{_ticket_context(ticket)}\n\n"
        f"Prior analysis (JSON):\n{analysis}\n\n"
        f"Existing test case (JSON):\n{existing_case}\n\n"
        "Return an improved version of this single test case with the same "
        "fields: title, objective, precondition, testData ([{field, value}]), "
        "steps ([{a, e}]), linkedAc, priority, testType, automation, platform.\n\n"
        f"Respond with ONLY a JSON object of this exact shape:\n{CASE_JSON_SHAPE}"
    )
