# ADR 0009 — Per-user workspace filesystem, artifact cloning, and the admin shared namespace

- **Status:** Accepted
- **Date:** 2026-07-09
- **Deciders:** Operator (in-session), Q-Agent build
- **Extends:** [ADR 0008](0008-per-user-ownership-and-claude-credentials.md) (per-user data ownership), [ADR 0002](0002-project-knowledge-config-and-multi-repo.md) (project knowledge/config/multi-repo)

## Context

ADR 0008 made the **database** per-user (`owner_id` on runs, tickets, projects,
project_config, provider_connections, project_knowledge, claude_usage). The
**filesystem did not follow.** Every workspace path is keyed by *project slug* or
*run code* only (`config.py` `specs_dir`/`evidence_dir`/`knowledge_dir`/`repos_dir`/
`auth_dir`), so two users who each own a project named "Surency" write to the same
`workspace/repos/Surency` and `workspace/knowledge/Surency` directories and collide
on the `unique` DB `key` of `ProjectConfig`/`ProjectKnowledge`. The one exception —
`workspace/claude-config/<owner_id|"shared">/` (ADR 0008) — is the pattern to
generalize.

Two workspace artifacts are **expensive to (re)build**: a repository's **Project
Knowledge Base** and the **repo clone** it traverses. `project-bootstrap` runs a
headless Claude agentic pass over a freshly-cloned repo with a **20-minute** timeout
(`claude_bootstrap_timeout_s = 1200`), billed in tokens. Forcing every user to
rebuild identical knowledge from scratch is wasteful, so users need a way to **clone**
a ready-built project instead of rebuilding it.

## Decision

### 1. The workspace filesystem is namespaced per owner
A single resolver maps an owner to an on-disk **scope**:

- owner present → `workspace/users/<owner_id>/`
- owner absent (`owner_id IS NULL`) → `workspace/shared/`

Every per-owner artifact tree lives under the scope root:
`…/<scope>/{specs,evidence,knowledge,repos,auth}/…`. The existing
`workspace/claude-config/<owner_id|"shared">/` is already isolated and is left as-is
(not moved) — it demonstrates the pattern. Global, non-owned state
(`q-agent.db`, `settings.json`, `.audit_backfilled`) stays at the workspace root.

The **auth-off local-dev** mode (`QAGENT_AUTH_REQUIRED` off → `current_user` is
`None` → `owner_id` unresolved) resolves to the `shared` scope: a single-tenant dev
box keeps one working tree, and that tree *is* the admin shared namespace when auth
is later turned on. This mirrors the ADR 0008 "bridge" (owner-less == shared).

A best-effort, one-time startup migration relocates any pre-existing **legacy flat**
artifact dirs (`workspace/{specs,evidence,knowledge,repos,auth}/…`) into
`workspace/shared/…`, treating pre-isolation data as shared. Workspace data is
git-ignored, local-first, and pre-release for this feature, so this is safe.

### 2. The admin shared namespace (owner_id NULL)
`workspace/shared/` and the matching `owner_id IS NULL` DB rows are the
**admin-managed shared space**. Admins build and maintain reference projects +
knowledge there; **members clone from it** but cannot write to it. Writes to the
shared namespace are gated by `require_admin` (reusing the ADR 0008 shared-Claude-
credential precedent — `owner_id NULL` = shared, admin-only to manage). No
publish/promote workflow and no peer-to-peer sharing: members only ever see their
own space plus the shared space.

### 3. Composite ownership uniqueness
`ProjectConfig.key` and `ProjectKnowledge.key` drop their **global** `unique`
constraint in favor of **composite-unique `(key, owner_id)`**, so the same project
name can exist once per user and once in the shared namespace. Delivered as an
Alembic migration covering PostgreSQL (prod) and SQLite (dev/tests, via
`batch_alter_table`).

### 4. Cloning copies rows *and* files, secrets included
A member clones a project **from the shared namespace into their own space**. The
clone copies, re-stamping `owner_id` to the caller (key unchanged):

- DB rows: `Project`, `ProjectConfig` (**including** the Fernet-encrypted
  `test_accounts` passwords), and all the project's `ProjectKnowledge` rows.
- On-disk artifacts from the source scope to the destination scope:
  `knowledge/<project>/…` (`knowledge.json` + `knowledge.md`), the `repos/<project>/…`
  git clone, and the `auth/<project>/…` saved login session
  (`storageState.json` / `sessionStorage.json`).

Secrets are copied verbatim: the Fernet key is process-wide, so ciphertext is valid
in the destination, and the shared source is admin-owned/trusted. This is the whole
point — the clone must be immediately runnable without re-paying the 20-minute
bootstrap or re-entering credentials.

### 5. Artifact serving stays owner-checked
Evidence is now served from `workspace/users/<scope>/evidence/<RUN-CODE>/…`. The
`/artifacts` static mount moves to the workspace root and its access guard
(`_artifact_access_allowed`) parses the **RUN-CODE** wherever it now sits in the
path (it is still globally unique — `Run.code` is `unique`), resolves the owning
`Run`, and enforces the ADR 0008 owner check. Generated artifact URLs gain the scope
prefix.

## Consequences

- **Positive:** true per-user file isolation (no cross-user path/key collisions);
  expensive AI-built knowledge is reusable via clone instead of rebuilt; a curated,
  admin-owned shared library; the design reuses the proven `owner_id|"shared"`
  credential pattern and the ADR 0008 ownership helpers.
- **Cost / risk:** the shared namespace holds real secrets (test-account passwords,
  login sessions) that clone into every member who copies from it — accepted because
  the source is admin-curated and trusted. The legacy→shared migration may leave a
  backfilled admin's pre-existing knowledge under `shared` rather than their own
  scope; re-cloning or a rebuild resolves it (dev-only data). On-disk isolation is
  only as strong as `QAGENT_AUTH_REQUIRED` being on (same caveat as ADR 0008).

## Not in scope (deferred / excluded)

- Publish/promote workflow and peer-to-peer (member↔member) sharing.
- Per-user re-encryption of secrets (single process-wide Fernet key retained).
- Shared-storage/volume backing for a multi-process worker deployment (Phase 6 of
  the migration plan) — the resolver is the seam that will make it possible.
- Quotas / garbage collection of abandoned per-user artifact trees.
