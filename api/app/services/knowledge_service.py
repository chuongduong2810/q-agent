"""Project Knowledge Base build — invokes Claude via the project-bootstrap skill.

Given a project's identity (name, provider, repo, framework) Claude produces a
structured knowledge base (stack, architecture, domain, locator strategy, and
counts of existing Playwright assets) that downstream AI actions reuse. Real
Claude only (ADR 0001); errors propagate to the caller.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from app.config import settings
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


def _slug(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", key).strip("-") or "project"


def write_knowledge_files(row: ProjectKnowledge) -> str:
    """Emit the skill's knowledge.json + knowledge.md artifacts under workspace/knowledge/<key>/.

    project-bootstrap's contract is to persist the Project Knowledge Base as files
    (knowledge.md + knowledge.json) that downstream skills read; we mirror the DB
    row into those files. Returns the directory path.
    """
    kn = row.knowledge or {}
    out_dir = settings.knowledge_dir / _slug(row.key)
    out_dir.mkdir(parents=True, exist_ok=True)

    # knowledge.json — shaped after skills/project-bootstrap/templates/knowledge.json.
    doc = {
        "project_name": row.name,
        "repository": row.repo,
        "branch": kn.get("branch", "main"),
        "purpose": "",
        "framework": kn.get("stack", [None])[0] if kn.get("stack") else "",
        "automation": row.framework,
        "language": "TypeScript",
        "stack": kn.get("stack", []),
        "architecture": kn.get("architecture", ""),
        "business_domain": kn.get("domain", ""),
        "locator_strategy": kn.get("locator", ""),
        "existing_assets": {
            "spec_files": kn.get("assets", 0),
            "page_objects": kn.get("pageObjects", 0),
            "fixtures": kn.get("fixtures", 0),
        },
        "reusable_utilities": kn.get("utilities", []),
        "confidence": row.confidence,
        "version": row.version,
        "indexed_at": row.last_indexed.isoformat() if row.last_indexed else None,
    }
    (out_dir / "knowledge.json").write_text(json.dumps(doc, indent=2), encoding="utf-8")

    utilities = "\n".join(f"- `{u}`" for u in kn.get("utilities", [])) or "- _none discovered_"
    stack = ", ".join(kn.get("stack", [])) or "—"
    md = f"""# Project Knowledge Base — {row.name}

- **Repository:** {row.repo or "—"}
- **Branch:** {kn.get("branch", "main")}
- **Automation framework:** {row.framework}
- **Confidence:** {row.confidence}%  ·  **Version:** {row.version}

## Technology stack
{stack}

## Application architecture
{kn.get("architecture", "—")}

## Business domain
{kn.get("domain", "—")}

## Locator strategy
{kn.get("locator", "—")}

## Existing Playwright assets
- Spec files: {kn.get("assets", 0)}
- Page objects: {kn.get("pageObjects", 0)}
- Shared fixtures: {kn.get("fixtures", 0)}

## Reusable test utilities
{utilities}

## AI Context Summary
{row.name} ({stack}). {kn.get("architecture", "")} Domain: {kn.get("domain", "")}
Prefer existing patterns and the locator strategy above; reuse the listed utilities.
"""
    (out_dir / "knowledge.md").write_text(md, encoding="utf-8")
    return str(out_dir)


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
    # Persist the skill's knowledge.md + knowledge.json artifacts to the workspace.
    row.doc_path = write_knowledge_files(row)
