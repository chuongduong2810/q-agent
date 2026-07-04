# ADR 0002 — Project Knowledge Base, Project Config, and multi-repo grounding

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** Operator (via in-session decisions), Q-Agent build
- **Supersedes/extends:** builds on [ADR 0001](0001-scope-architecture-and-live-integrations.md)

## Context

The generated Playwright specs shipped by ADR 0001 were full of placeholders
(test account, base URL, group/entity IDs, selectors) because project context
never reached the generators: the spec prompt saw only a test case's title/steps
and was told to "use placeholders", the knowledge base stored almost nothing
concrete, and `requirement-analyst` / `test-case-generator` received no project
context. There was also no place to store a test account or base URL, and the
model conflated "project" with a single repo — but an ADO/GitHub project holds
many repos.

## Decision

1. **Project Config (user-authored, server-side).** A `ProjectConfig` (per
   project key) holds base URL, per-environment URLs, **test accounts**, the
   repository list, and arbitrary extra key/values, edited on **Project Details →
   Settings**. Test-account passwords are **encrypted at rest** (reusing the
   ADR 0001 Fernet scheme) and never returned in plaintext (masked as
   `hasPassword`); the backend decrypts them only to feed generation.

2. **Project Knowledge Base per repository.** `project-bootstrap` produces a
   knowledge base (stack, architecture, domain, base URL, real routes, real
   selectors, auth/login flow, environments, reusable Page Objects/fixtures) as
   `knowledge.md` + `knowledge.json`. Knowledge is keyed per **(project, repo)**
   and stored under `workspace/knowledge/<project>/<repo>/`.

3. **Real source traversal.** When a repo has a local checkout path or a remote
   clone URL, the Claude CLI runs with its working directory set to that checkout
   so its file tools discover real routes/selectors/auth instead of inferring
   them. Remote repos are cloned/pulled into `workspace/repos/<project>/<repo>`;
   private repos authenticate with the matching provider's PAT (by URL host).
   Repos are discovered from the provider (ADO `git/repositories`, GitHub org
   repos) or added manually.

4. **Multi-repo projects.** A project owns many repositories. One repo is flagged
   **default** — the app automation targets and whose knowledge base grounds
   generation when a run doesn't specify a repo.

5. **Downstream grounding.** `requirement-analyst`, `test-case-generator`, and
   `automation-generator` consume the Project Knowledge Base + Project Config.
   Per operator choice, generated specs **bake in literal real values** (base URL,
   routes, selectors, and test-account credentials) so they run with little to no
   manual editing, rather than referencing env vars. `test-case-generator` also
   defaults automatable web/UI cases to `Playwright` (reserving `Manual` for
   genuinely non-automatable cases); the automation type is editable in the
   Review Center.

6. **Local (dry-run) Create & Link.** The create-and-link step supports a local
   mode that records approved cases locally (marked `LOCAL-…`) and never writes to
   the provider — to avoid cluttering a live project during development.

## Consequences

- **Positive:** Generated automation is runnable against the real app with minimal
  edits; downstream skills reuse a single, consistent project context; multiple
  apps per project are first-class; developers can exercise the full pipeline
  locally without polluting a live tenant.
- **Cost / risk:** Generated `*.spec.ts` files contain literal credentials
  (operator's explicit choice). Mitigations: the `workspace/` tree (specs, repos,
  knowledge) is local-first and git-ignored, and passwords are kept **out** of the
  on-disk knowledge artifacts — only the generated specs and the encrypted DB hold
  them. Real selector/route fidelity depends on a checkout being available; without
  one, `project-bootstrap` falls back to best-effort inference.
- **Provider coverage:** ADO repo discovery and `org/repo` GitHub shorthand work
  out of the box; other hosts (or ADO's `org/project/_git/repo` layout) need an
  explicit clone URL.
- **Backward compatibility:** the earlier single-repo fields (`repo_url`,
  `local_repo_path`) and the project-level `/knowledge` endpoints remain; a lone
  repo is synthesized from them when no repo list is configured.

## Alternatives considered

- *Env-var / generated-config credentials instead of literal values* — more secure
  (no secrets in spec files) but leaves a one-time setup step; rejected in favor of
  zero-manual-edit runnability per operator choice.
- *One aggregate knowledge base per project (all repos merged)* / *primary +
  secondary repos* — simpler, but blurs which routes/selectors belong to which app;
  rejected in favor of a knowledge base per repository.
