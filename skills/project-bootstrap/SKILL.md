---
name: project-bootstrap
description: Learn a software project and build a reusable Project Knowledge Base (knowledge.md + knowledge.json) before any downstream QA work. Use this FIRST, once per project, whenever no Project Knowledge Base exists yet, or when the user asks to "index the codebase", "bootstrap the project", "learn this repo for QA", or before running requirement analysis, test-case generation, or automation generation.
version: 1.0.0
author: Andrew
---

# Project Bootstrap & Codebase Indexing

## Purpose

Learn a software project **before** generating any requirements analysis, test cases, or
automation, and persist that understanding as a reusable **Project Knowledge Base**.

Every other skill in this QA pipeline reads the Project Knowledge Base instead of
re-discovering the codebase. Running this skill once produces two synchronized artifacts:

- `knowledge.md` — human-readable knowledge base
- `knowledge.json` — machine-readable context for downstream AI agents

## Position in the QA Pipeline

```
[project-bootstrap]  ← you are here (run once per project)
        ↓ knowledge.md + knowledge.json
requirement-analyst → test-case-generator → test-case-reviewer
        → automation-generator → automation-reviewer → execution-analyzer
        → screenshot-annotator / ticket-comment-generator / report-generator
```

## When to Use

- No Project Knowledge Base exists for the target repository yet.
- The codebase changed materially (new framework, new automation project, restructured folders).
- A downstream skill reports that `knowledge.md` / `knowledge.json` is missing or stale.

Do **not** re-run on every ticket. The knowledge base is meant to be reused.

## Inputs

- Read all stuff needed for bootstrap from project code base from provided configuration, URL, PAT.
  - `README.md`, `docs/`, architecture documents
  - Existing automation project, if any (Playwright / Selenium / Cypress / WebdriverIO)
  - Package manifests (`package.json`, `*.csproj`, `pom.xml`, `requirements.txt`, etc.)

## Constraints

- **Read-only.** Never modify source code.
- Never generate test cases or automation during indexing.
- Never install dependencies unless explicitly requested.
- Never invent frameworks, APIs, components, or domain concepts that are not evidenced in the code.

## Workflow

1. **Detect the stack** — languages, frameworks, build tools, package managers, from manifests and config.
2. **Map the architecture** — frontend/backend frameworks, folder structure, module boundaries, layers.
3. **Inventory automation assets** — existing test framework, config, Page Objects, fixtures, helpers, test data factories.
4. **Determine locator strategy** — the project's actual selector priority (data-testid → getByRole → getByLabel → CSS → XPath), with real examples found in the code.
5. **Learn authentication** — login flow, session handling, reusable auth helpers / storage state.
6. **Extract coding standards** — naming, folder conventions, assertion style, async pattern, error handling, comment density.
7. **Extract business domain knowledge** — entities, user roles, workflows, business rules, glossary — from docs and code.
8. **Catalog routes, UI components, APIs, environment config, and external integrations** (Azure DevOps, Jira, storage, email, etc.).
9. **Validate completeness** — record what is unknown under "Missing Information" rather than guessing.
10. **Emit both artifacts** — populate `templates/knowledge.md`, then produce a synchronized `knowledge.json` using `templates/knowledge.json`.

## Output

Write both files to the project (default location `docs/qa/knowledge.md` and `docs/qa/knowledge.json`,
or wherever the user specifies). Populate every section of `templates/knowledge.md`. Keep the
`.md` and `.json` **synchronized** — every fact in the JSON must be traceable to the Markdown.

The Markdown must end with a concise **AI Context Summary** (500–1000 words) optimized for
downstream agents.

## Quality Rules

- Prefer existing project patterns over generic solutions.
- Reuse existing helpers and Page Objects — name them so downstream skills can reference them.
- Distinguish **facts** (found in code) from **assumptions** (inferred) explicitly.
- State uncertainty; put gaps under "Missing Information".
- Keep output deterministic and Markdown-structured.

## Handoff / Success Criteria

After this skill runs, `requirement-analyst`, `test-case-generator`, and `automation-generator`
should be able to work **without re-reading the whole codebase** — they consume the knowledge base.
Success means a downstream agent can name the correct framework, locator strategy, reusable
Page Objects, and domain terminology purely from `knowledge.md` / `knowledge.json`.
