"""Project Knowledge Base build — invokes Claude via the project-bootstrap skill.

Given a project's identity (name, provider, repo, framework) Claude produces a
structured knowledge base (stack, architecture, domain, locator strategy, and
counts of existing Playwright assets) that downstream AI actions reuse. Real
Claude only (ADR 0001); errors propagate to the caller.
"""

from __future__ import annotations

from typing import Any

from app.db import utcnow
from app.models.knowledge import ProjectKnowledge
from app.services.claude_cli import run_json
from app.services.skills import PROJECT_BOOTSTRAP


def _build_prompt(name: str, provider: str, repo: str, framework: str) -> str:
    return (
        "Build a Project Knowledge Base for this software project so a QA "
        "automation agent understands it before writing tests.\n\n"
        f"Project name: {name}\n"
        f"Provider: {provider or 'unknown'}\n"
        f"Repository: {repo or 'unknown'}\n"
        f"Automation framework: {framework or 'Playwright'}\n\n"
        "Return a JSON object with EXACTLY these keys:\n"
        '{"branch": string, "stack": string[], "architecture": string, '
        '"domain": string, "locator": string, "assets": number, '
        '"pageObjects": number, "fixtures": number, "utilities": string[], '
        '"confidence": number (0-100)}\n'
        "- architecture: 1-2 sentences on the app's architecture.\n"
        "- domain: 1 sentence on the business domain.\n"
        "- locator: the recommended Playwright locator strategy.\n"
        "- assets/pageObjects/fixtures: best-estimate counts of existing Playwright assets.\n"
        "- confidence: how confident this knowledge base is (0-100)."
    )


def build_knowledge_payload(name: str, provider: str, repo: str, framework: str) -> dict[str, Any]:
    """Call Claude (project-bootstrap skill) and normalize the JSON result."""
    raw = run_json(
        _build_prompt(name, provider, repo, framework),
        skill=PROJECT_BOOTSTRAP,
        include_template=True,
        label=f"Build knowledge: {name}",
    )
    data = raw if isinstance(raw, dict) else {}
    confidence = int(data.get("confidence", 80) or 0)
    confidence = max(0, min(100, confidence))
    knowledge = {
        "branch": data.get("branch", "main"),
        "stack": data.get("stack", []) or [],
        "architecture": data.get("architecture", ""),
        "domain": data.get("domain", ""),
        "locator": data.get("locator", ""),
        "assets": int(data.get("assets", 0) or 0),
        "pageObjects": int(data.get("pageObjects", 0) or 0),
        "fixtures": int(data.get("fixtures", 0) or 0),
        "utilities": data.get("utilities", []) or [],
    }
    return {"knowledge": knowledge, "confidence": confidence}


def apply_build(row: ProjectKnowledge, payload: dict[str, Any]) -> None:
    """Persist a build result onto a ProjectKnowledge row (caller commits).

    First index stays ``v1``; each subsequent (re)build increments the version.
    """
    rebuild = row.status == "indexed"
    if rebuild:
        try:
            n = int((row.version or "v1").lstrip("v") or "1")
        except ValueError:
            n = 1
        row.version = f"v{n + 1}"
    else:
        row.version = "v1"
    row.knowledge = payload["knowledge"]
    row.confidence = payload["confidence"]
    row.status = "indexed"
    row.needs_refresh = False
    row.last_indexed = utcnow()
