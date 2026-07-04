"""Resolve a traversable local checkout of an application repo for project-bootstrap.

Resolution order, best-effort (never raises — a failure just means Claude falls
back to metadata inference):

1. A configured ``local_repo_path`` that exists on disk — used as-is, no network.
2. Otherwise a remote git URL (the project's ``repo_url``, or one derived from the
   provider + repo identifier) is cloned/pulled into ``workspace/repos/<slug>`` and
   that checkout is traversed.

Private repos are authenticated by injecting the matching provider's PAT
(``secrets['pat']``) into the HTTPS URL. Tokens are redacted from all logs.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from sqlalchemy.orm import Session

from app import crypto
from app.config import settings
from app.logging import logger
from app.models.provider import Provider

_CLONE_TIMEOUT_S = 180


def _slug(key: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "-", key).strip("-") or "project"


def _redact(url: str) -> str:
    """Hide any embedded credentials before logging a URL."""
    return re.sub(r"://[^@/]+@", "://***@", url)


def _provider_kind_for_host(host: str) -> str | None:
    host = host.lower()
    if "github" in host:
        return "github"
    if "azure.com" in host or "visualstudio.com" in host:
        return "ado"
    return None


def _derive_url(repo: str, provider_display: str) -> str:
    """Best-effort clone URL from a bare repo identifier (e.g. 'org/repo').

    Only GitHub's ``org/repo`` shorthand is derivable unambiguously. For other
    hosts (notably Azure DevOps) the user should supply an explicit ``repo_url``.
    """
    repo = (repo or "").strip()
    if not repo:
        return ""
    if repo.startswith(("http://", "https://", "git@", "ssh://")):
        return repo
    if re.fullmatch(r"[\w.-]+/[\w.-]+", repo) and "github" in (provider_display or "github").lower():
        return f"https://github.com/{repo}.git"
    return ""


def _pat_for(db: Session, kind: str | None) -> str:
    if not kind:
        return ""
    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        return ""
    return crypto.decrypt((provider.secrets or {}).get("pat", "")) or ""


def _authenticated_url(url: str, pat: str) -> str:
    """Inject a PAT into an HTTPS URL that has no credentials of its own."""
    if not pat or not url.startswith("https://"):
        return url
    parsed = urlparse(url)
    if "@" in parsed.netloc:  # URL already carries credentials
        return url
    netloc = f"{pat}@{parsed.netloc}"
    return urlunparse(parsed._replace(netloc=netloc))


def _run_git(args: list[str]) -> bool:
    """Run a git command; return True on success. Never raises."""
    try:
        proc = subprocess.run(  # noqa: S603
            ["git", *args],
            capture_output=True,
            text=True,
            timeout=_CLONE_TIMEOUT_S,
            encoding="utf-8",
        )
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        logger.warning("git {} failed: {}", args[0], exc)
        return False
    if proc.returncode != 0:
        logger.warning("git {} exited {}: {}", args[0], proc.returncode, proc.stderr.strip()[:300])
        return False
    return True


def materialize_remote(
    db: Session, key: str, repo_url: str, provider_display: str = "", repo_name: str = ""
) -> str | None:
    """Clone (or pull) ``repo_url`` into workspace/repos/<project>[/<repo>]; return path or None.

    Args:
        db: Active session (to look up the provider PAT for private repos).
        key: Project key — determines the on-disk clone directory.
        repo_url: Explicit git URL, or a bare identifier we can derive one from.
        provider_display: The project's provider label, used to guess the host
            when only a bare ``org/repo`` identifier is available.
        repo_name: When set, clone into a per-repo subdirectory so a project's
            many repos each get their own checkout (per-repo knowledge).

    Returns:
        The local checkout path, or None when no URL is resolvable or git fails.
    """
    url = repo_url.strip() or _derive_url(repo_url, provider_display)
    if not url:
        return None

    host = urlparse(url).hostname or ""
    pat = _pat_for(db, _provider_kind_for_host(host))
    authed = _authenticated_url(url, pat)

    dest = settings.repos_dir / _slug(key)
    if repo_name:
        dest = dest / _slug(repo_name)
    if (dest / ".git").is_dir():
        logger.info("Pulling latest for {} into {}", _redact(url), dest)
        # Refresh to the remote's default branch; robust for shallow clones.
        ok = _run_git(["-C", str(dest), "fetch", "--depth", "1", "origin"]) and _run_git(
            ["-C", str(dest), "reset", "--hard", "origin/HEAD"]
        )
        if ok:
            return str(dest)
        # Fall through to a fresh clone if the pull could not reconcile.
        logger.info("Pull failed for {}; re-cloning", _redact(url))
        _rmtree(dest)

    dest.parent.mkdir(parents=True, exist_ok=True)
    logger.info("Cloning {} into {}", _redact(url), dest)
    if _run_git(["clone", "--depth", "1", authed, str(dest)]):
        return str(dest)
    _rmtree(dest)
    return None


def _rmtree(path: Path) -> None:
    import shutil

    try:
        shutil.rmtree(path, ignore_errors=True)
    except OSError:
        pass


def resolve_repo_path(
    db: Session, key: str, config, provider_display: str = "", repo: str = ""
) -> str | None:
    """Return a local checkout to traverse: configured local path, else a clone.

    Args:
        db: Active session.
        key: Project key.
        config: The project's ProjectConfig row (or None).
        provider_display: Provider label for URL derivation/PAT lookup.
        repo: Repo identifier fallback (e.g. ProjectKnowledge.repo) when no
            explicit ``repo_url`` is configured.

    Returns:
        A local directory path, or None if nothing is available.
    """
    if config and config.local_repo_path and Path(config.local_repo_path).is_dir():
        return config.local_repo_path

    repo_url = (config.repo_url if config and config.repo_url else "") or repo
    if not repo_url:
        return None
    return materialize_remote(db, key, repo_url, provider_display)


def resolve_one_repo(
    db: Session, project_key: str, repo: dict, provider_display: str = ""
) -> str | None:
    """Resolve a single project repo to a local checkout for bootstrap traversal.

    Uses the repo's ``local_repo_path`` if it exists, else clones/pulls its
    ``repo_url`` into ``workspace/repos/<project>/<repo>``.
    """
    local = (repo.get("local_repo_path") or "").strip()
    if local and Path(local).is_dir():
        return local
    repo_url = (repo.get("repo_url") or "").strip()
    if not repo_url:
        return None
    return materialize_remote(
        db, project_key, repo_url, provider_display, repo_name=repo.get("name", "")
    )
