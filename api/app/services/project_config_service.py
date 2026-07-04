"""Project configuration + project-context resolution.

Two responsibilities:

1. **Persist** user-authored project config (base URL, test accounts, environments,
   local repo path, extra values), encrypting test-account passwords at rest and
   masking them on the way out — mirroring provider-credential handling.
2. **Resolve** the full project context for a ticket/test case so downstream AI
   actions (requirement analysis, test-case generation, Playwright generation) get
   a complete, consistent picture instead of missing context or placeholders.

A test case only knows its ``ticket_external_id`` and ``provider_kind``; tickets
are not reliably linked to a Project row, so we resolve the project **key** from
the provider's configured project name (which equals the Project Knowledge key,
e.g. ADO ``config.project = "Surency Platform"``), falling back to the sole
configured project when only one exists.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from app import crypto
from app.config import settings
from app.models.knowledge import ProjectKnowledge, compose_key
from app.models.project_config import ProjectConfig
from app.models.provider import Provider
from app.models.ticket import Ticket


# --------------------------------------------------------------- persistence
def get_config(db: Session, key: str) -> ProjectConfig | None:
    """Return the ProjectConfig row for a project key, or None."""
    return db.query(ProjectConfig).filter(ProjectConfig.key == key).first()


def upsert_config(db: Session, key: str, patch: dict[str, Any]) -> ProjectConfig:
    """Create or update a project's config from a partial patch (caller commits).

    Test-account passwords in ``patch['test_accounts']`` are plaintext on input and
    encrypted before persistence. A blank/absent password on an account preserves
    the previously stored (encrypted) password for the same role+username so the UI
    can save the masked form without wiping the secret.

    Args:
        db: Active session.
        key: Project key (project name).
        patch: Partial config — any of base_url, local_repo_path, environments,
            test_accounts, extra, name.

    Returns:
        The upserted ProjectConfig row (not yet committed).
    """
    row = get_config(db, key)
    if row is None:
        row = ProjectConfig(key=key, name=patch.get("name", key))
        db.add(row)
    if "name" in patch and patch["name"]:
        row.name = patch["name"]
    if "base_url" in patch and patch["base_url"] is not None:
        row.base_url = patch["base_url"].strip()
    if "local_repo_path" in patch and patch["local_repo_path"] is not None:
        row.local_repo_path = patch["local_repo_path"].strip()
    if "repo_url" in patch and patch["repo_url"] is not None:
        row.repo_url = patch["repo_url"].strip()
    if "repos" in patch and patch["repos"] is not None:
        row.repos = _normalize_repos(patch["repos"])
    if "environments" in patch and patch["environments"] is not None:
        row.environments = patch["environments"]
    if "extra" in patch and patch["extra"] is not None:
        row.extra = patch["extra"]
    if "test_accounts" in patch and patch["test_accounts"] is not None:
        row.test_accounts = _encrypt_accounts(patch["test_accounts"], row.test_accounts or [])
    if "manual_auth" in patch and patch["manual_auth"] is not None:
        row.manual_auth = bool(patch["manual_auth"])
    return row


def _normalize_repos(incoming: list[dict]) -> list[dict]:
    """Clean a submitted repo list; ensure at most one repo is flagged default."""
    out: list[dict] = []
    seen_default = False
    for r in incoming:
        name = (r.get("name") or "").strip()
        if not name:
            continue
        is_default = bool(r.get("default")) and not seen_default
        seen_default = seen_default or is_default
        out.append(
            {
                "name": name,
                "repo_url": (r.get("repo_url") or "").strip(),
                "default_branch": (r.get("default_branch") or "").strip(),
                "local_repo_path": (r.get("local_repo_path") or "").strip(),
                "default": is_default,
            }
        )
    # If none was flagged default, the first repo becomes the default target.
    if out and not any(r["default"] for r in out):
        out[0]["default"] = True
    return out


def get_repos(config: ProjectConfig | None) -> list[dict]:
    """Return a project's repos, synthesizing one from legacy fields if needed."""
    if config and config.repos:
        return config.repos
    if config and (config.repo_url or config.local_repo_path):
        name = ""
        if config.repo_url:
            name = config.repo_url.rstrip("/").rsplit("/", 1)[-1].removesuffix(".git")
        return [
            {
                "name": name or "repo",
                "repo_url": config.repo_url,
                "default_branch": "",
                "local_repo_path": config.local_repo_path,
                "default": True,
            }
        ]
    return []


def default_repo(config: ProjectConfig | None) -> dict | None:
    """The repo automation targets by default (flagged default, else first)."""
    repos = get_repos(config)
    if not repos:
        return None
    return next((r for r in repos if r.get("default")), repos[0])


def _encrypt_accounts(incoming: list[dict], existing: list[dict]) -> list[dict]:
    """Encrypt plaintext passwords; keep the stored secret when input is blank."""
    prior: dict[tuple[str, str], str] = {
        (a.get("role", ""), a.get("username", "")): a.get("password", "")
        for a in existing
    }
    out: list[dict] = []
    for acct in incoming:
        role = acct.get("role", "")
        username = acct.get("username", "")
        password = acct.get("password", "")
        if not password:
            stored = prior.get((role, username), "")
            encrypted = stored  # already encrypted (or empty)
        else:
            encrypted = crypto.encrypt(password)
        out.append(
            {
                "role": role,
                "username": username,
                "password": encrypted,
                "notes": acct.get("notes", ""),
            }
        )
    return out


def public_config(row: ProjectConfig | None, key: str, name: str = "") -> dict[str, Any]:
    """Serialize a config row for the UI, masking passwords (never plaintext)."""
    if row is None:
        return {
            "key": key,
            "name": name or key,
            "baseUrl": "",
            "repos": [],
            "localRepoPath": "",
            "repoUrl": "",
            "environments": [],
            "testAccounts": [],
            "extra": {},
            "manualAuth": False,
        }
    return {
        "key": row.key,
        "name": row.name or row.key,
        "baseUrl": row.base_url,
        "repos": get_repos(row),
        "localRepoPath": row.local_repo_path,
        "repoUrl": row.repo_url,
        "environments": row.environments or [],
        "testAccounts": [
            {
                "role": a.get("role", ""),
                "username": a.get("username", ""),
                "notes": a.get("notes", ""),
                "hasPassword": bool(a.get("password")),
            }
            for a in (row.test_accounts or [])
        ],
        "extra": row.extra or {},
        "manualAuth": bool(row.manual_auth),
    }


# --------------------------------------------------------------- manual auth
def _slug(key: str) -> str:
    """Filesystem-safe slug for a project key (mirrors knowledge_service._slug)."""
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", key).strip("-") or "project"


def auth_path(project_key: str) -> Path:
    """Absolute path to a project's saved Playwright session file.

    Located at ``settings.auth_dir / <project-slug> / "storageState.json"``.
    The file may not exist yet (nothing is created here).
    """
    return settings.auth_dir / _slug(project_key) / "storageState.json"


def session_path(project_key: str) -> Path:
    """Absolute path to a project's saved sessionStorage snapshot.

    Sibling of the ``storageState.json`` at :func:`auth_path`, located at
    ``settings.auth_dir / <project-slug> / "sessionStorage.json"``. Captures the
    MSAL/SPA tokens that live in ``sessionStorage`` (which Playwright's
    ``storageState`` cannot persist). The file may not exist yet.
    """
    return auth_path(project_key).parent / "sessionStorage.json"


def auth_state(project_key: str) -> dict[str, Any]:
    """Report whether a saved session exists and, if so, when it was captured.

    Returns a dict shaped for :class:`app.schemas.AuthStateOut`::

        {"exists": bool, "capturedAt": datetime | None}

    ``capturedAt`` is derived from the session file's modification time (UTC).
    """
    path = auth_path(project_key)
    if not path.exists():
        return {"exists": False, "capturedAt": None}
    captured_at = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return {"exists": True, "capturedAt": captured_at}


def clear_auth(project_key: str) -> dict[str, Any]:
    """Delete a project's saved session file (if any) and return the empty state."""
    path = auth_path(project_key)
    if path.exists():
        path.unlink()
    return auth_state(project_key)


def base_url_for(db: Session, provider_kind: str, env: str = "") -> str:
    """Resolve the base URL a run should target for a provider's project.

    Reuses :func:`build_context` so per-environment URL selection stays consistent
    with the rest of the pipeline. Returns "" when no project/base URL resolves.
    """
    return build_context(db, provider_kind, env=env).get("baseUrl", "") or ""


# --------------------------------------------------------------- resolution
def resolve_project_key(db: Session, provider_kind: str) -> str | None:
    """Best-effort map a provider to the project key its tickets belong to.

    Order: (1) the provider's configured project name if it has a config/knowledge
    row; (2) the sole configured project when exactly one exists; else None.
    """
    provider = db.query(Provider).filter(Provider.kind == provider_kind).first()
    if provider:
        cfg = provider.config or {}
        candidate = cfg.get("project") or cfg.get("repo") or cfg.get("org") or ""
        if candidate and (
            get_config(db, candidate)
            or db.query(ProjectKnowledge)
            .filter(ProjectKnowledge.project_key == candidate)
            .first()
        ):
            return candidate

    keys = {c.key for c in db.query(ProjectConfig).all()}
    keys |= {k.project_key for k in db.query(ProjectKnowledge).all() if k.project_key}
    if len(keys) == 1:
        return next(iter(keys))
    return None


def repo_options(db: Session, project_key: str) -> list[dict[str, Any]]:
    """List a project's repos with their per-repo knowledge status.

    Each entry is ``{name, default, status}`` where ``status`` is the matching
    ``ProjectKnowledge`` row's status (keyed ``compose_key(project_key, name)``),
    defaulting to ``"not_indexed"`` when no knowledge base has been built.

    Args:
        db: Active session.
        project_key: The resolved project key.

    Returns:
        One entry per configured repo (empty list when the project has no repos).
    """
    cfg = get_config(db, project_key)
    out: list[dict[str, Any]] = []
    for repo in get_repos(cfg):
        name = repo.get("name", "")
        kn = (
            db.query(ProjectKnowledge)
            .filter(ProjectKnowledge.key == compose_key(project_key, name))
            .first()
        )
        out.append(
            {
                "name": name,
                "default": bool(repo.get("default")),
                "status": kn.status if kn else "not_indexed",
            }
        )
    return out


def build_context(
    db: Session, provider_kind: str, env: str = "", repo: str | None = None
) -> dict[str, Any]:
    """Assemble the full project context downstream AI actions consume.

    Combines the user-authored ProjectConfig (base URL, test accounts,
    environments, extra) with the discovered ProjectKnowledge (domain, routes,
    selectors, auth, locator strategy). Test-account passwords ARE decrypted here
    because the caller injects them into generated automation; this dict must never
    be logged or returned over the API.

    Args:
        db: Active session.
        provider_kind: The ticket's provider (ado/jira/github).
        env: Optional environment name to pick a matching per-env base URL.
        repo: Optional target repository NAME. When it is a non-empty configured
            repo name, that repo's per-repo knowledge base is loaded (instead of
            the project's default repo). Empty/None keeps the default-repo
            behavior.

    Returns:
        A context dict (empty-ish if no project resolves). Keys: projectKey,
        repo, repoOptions, baseUrl, testAccounts (with decrypted passwords),
        environments, extra, plus flattened knowledge fields (domain,
        architecture, locator, routes, selectors, auth, businessEntities, stack,
        pageObjects/fixtures counts).
    """
    key = resolve_project_key(db, provider_kind)
    context: dict[str, Any] = {"projectKey": key or ""}
    if not key:
        return context

    cfg = get_config(db, key)
    context["repoOptions"] = repo_options(db, key)

    # Pick the target repo: an explicit, configured repo name wins; otherwise the
    # project's default repo. ``target_name`` drives which per-repo KB we load.
    configured_names = {opt["name"] for opt in context["repoOptions"]}
    default = default_repo(cfg)
    default_name = default.get("name", "") if default else ""
    target_name = repo if (repo and repo in configured_names) else default_name
    context["repo"] = target_name
    if cfg:
        base_url = cfg.base_url
        # Prefer a per-environment URL when the run's env matches one.
        if env:
            for e in cfg.environments or []:
                if str(e.get("name", "")).lower() == env.lower() and e.get("base_url"):
                    base_url = e["base_url"]
                    break
        context["baseUrl"] = base_url
        context["localRepoPath"] = cfg.local_repo_path
        context["environments"] = cfg.environments or []
        context["extra"] = cfg.extra or {}
        context["testAccounts"] = [
            {
                "role": a.get("role", ""),
                "username": a.get("username", ""),
                "password": crypto.decrypt(a.get("password", "")) or "",
                "notes": a.get("notes", ""),
            }
            for a in (cfg.test_accounts or [])
        ]

    # Per-repo knowledge: prefer the target repo's KB, falling back to a
    # project-level (legacy) row keyed by the bare project key.
    kn_row = None
    if target_name:
        kn_row = (
            db.query(ProjectKnowledge)
            .filter(ProjectKnowledge.key == compose_key(key, target_name))
            .first()
        )
    if kn_row is None:
        kn_row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == key).first()
    if kn_row:
        kn = kn_row.knowledge or {}
        context.setdefault("baseUrl", kn.get("base_url", ""))
        context["domain"] = kn.get("domain", "")
        context["architecture"] = kn.get("architecture", "")
        context["locator"] = kn.get("locator", "")
        context["routes"] = kn.get("routes", [])
        context["selectors"] = kn.get("selectors", [])
        context["auth"] = kn.get("auth", {})
        context["businessEntities"] = kn.get("business_entities", [])
        context["stack"] = kn.get("stack", [])
        # Names of reusable assets (distinct from the integer counts the UI shows).
        context["pageObjectNames"] = kn.get("page_object_names", [])
        context["fixtureNames"] = kn.get("fixture_names", [])
        context["utilities"] = kn.get("utilities", [])
    return context


def context_for_ticket(
    db: Session, ticket: Ticket, env: str = "", repo: str | None = None
) -> dict[str, Any]:
    """Convenience: build the project context for a specific ticket.

    ``repo`` (a target repository name) is threaded through so the context loads
    that repo's per-repo knowledge base rather than the project default repo's.
    """
    return build_context(db, ticket.provider_kind, env=env, repo=repo)
