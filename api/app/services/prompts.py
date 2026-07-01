"""Prompt builders for the Claude CLI calls used by the AI pipeline.

Each builder returns a single prompt string that instructs Claude to respond
with strict JSON matching the shape the caller (``app.services.ai_service``)
will parse. Keeping the prompts here (rather than inline) makes the expected
JSON contracts easy to find and change in one place.
"""

from __future__ import annotations

from app.models.ticket import Ticket

ANALYSIS_JSON_SHAPE = """{
  "businessRules": string[],
  "functionalRequirements": string[],
  "validationRules": string[],
  "risks": string[],
  "edgeCases": string[],
  "missingInformation": string[],
  "suggestedScope": string
}"""

CASES_JSON_SHAPE = """[
  {
    "title": string,
    "precondition": string,
    "steps": [ { "a": string, "e": string } ],
    "priority": "High" | "Medium" | "Low",
    "testType": string,
    "automation": "Playwright" | "Selenium" | "Cypress" | "Manual",
    "platform": string
  }
]"""

CASE_JSON_SHAPE = """{
  "title": string,
  "precondition": string,
  "steps": [ { "a": string, "e": string } ],
  "priority": "High" | "Medium" | "Low",
  "testType": string,
  "automation": "Playwright" | "Selenium" | "Cypress" | "Manual",
  "platform": string
}"""


def _ticket_context(ticket: Ticket) -> str:
    """Render the ticket fields Claude needs: title, description, acceptance criteria."""
    ac = "\n".join(f"- {item}" for item in (ticket.acceptance_criteria or [])) or "(none provided)"
    return (
        f"Ticket {ticket.external_id}: {ticket.title}\n\n"
        f"Description:\n{ticket.description or '(none provided)'}\n\n"
        f"Acceptance Criteria:\n{ac}"
    )


def build_analysis_prompt(ticket: Ticket) -> str:
    """Prompt asking Claude to analyze a ticket's requirements.

    Returns a JSON object with businessRules, functionalRequirements,
    validationRules, risks, edgeCases, missingInformation, suggestedScope.
    """
    return (
        "You are a senior QA analyst. Analyze the following work item and extract "
        "the information a QA engineer needs before writing manual test cases.\n\n"
        f"{_ticket_context(ticket)}\n\n"
        "Identify: business rules implied by the requirements, functional "
        "requirements, validation rules (input constraints, formats, boundaries), "
        "risks (things likely to break or be misunderstood), edge cases worth "
        "testing, any missing information that should be clarified with the "
        "author, and a one-sentence suggested test scope.\n\n"
        f"Respond with ONLY a JSON object of this exact shape:\n{ANALYSIS_JSON_SHAPE}"
    )


def build_generation_prompt(ticket: Ticket, analysis: dict, max_cases: int = 8) -> str:
    """Prompt asking Claude to generate ADO-style manual test cases for a ticket.

    Returns a JSON array of case objects (title, precondition, steps, priority,
    testType, automation, platform). ``max_cases`` caps how many are generated.
    """
    return (
        "You are a senior QA engineer. Using the ticket and the prior requirement "
        "analysis below, write a set of ADO-style manual test cases that give good "
        "coverage of the acceptance criteria, business rules, and edge cases.\n\n"
        f"Generate AT MOST {max_cases} test cases — prioritise the highest-value "
        "coverage if you would otherwise exceed that.\n\n"
        f"{_ticket_context(ticket)}\n\n"
        f"Prior analysis (JSON):\n{analysis}\n\n"
        "Each test case must have: a clear title, a precondition, a list of steps "
        "where each step has an action (a) and expected result (e), a priority "
        "(High/Medium/Low), a testType (e.g. Functional, Negative, Boundary, "
        "Security), an automation type (Playwright/Selenium/Cypress/Manual), and a "
        "platform (e.g. Web).\n\n"
        f"Respond with ONLY a JSON array of this exact shape:\n{CASES_JSON_SHAPE}"
    )


def build_case_regenerate_prompt(ticket: Ticket, analysis: dict, existing_case: dict) -> str:
    """Prompt asking Claude to regenerate a single test case, keeping its intent/code.

    Returns a JSON object with the same shape as one entry from
    ``build_generation_prompt``'s array.
    """
    return (
        "You are a senior QA engineer. Rewrite/improve the single test case below "
        "for the given ticket, using the prior requirement analysis for context. "
        "Keep it focused on the same testing intent, but improve clarity, "
        "correctness, and coverage.\n\n"
        f"{_ticket_context(ticket)}\n\n"
        f"Prior analysis (JSON):\n{analysis}\n\n"
        f"Existing test case (JSON):\n{existing_case}\n\n"
        "Return an improved version of this single test case with the same "
        "fields: title, precondition, steps ([{a, e}]), priority, testType, "
        "automation, platform.\n\n"
        f"Respond with ONLY a JSON object of this exact shape:\n{CASE_JSON_SHAPE}"
    )
