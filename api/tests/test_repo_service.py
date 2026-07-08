"""Tests for repo_service: URL derivation, auth injection, redaction, resolution."""

from __future__ import annotations

from app.services import repo_service


def test_derive_github_shorthand():
    assert repo_service._derive_url("org/repo", "GitHub") == "https://github.com/org/repo.git"
    # Explicit URLs pass through untouched.
    assert repo_service._derive_url("https://x/y.git", "") == "https://x/y.git"
    # Ambiguous host with a bare identifier is not derivable.
    assert repo_service._derive_url("org/repo", "Azure DevOps") == ""
    assert repo_service._derive_url("", "GitHub") == ""


def test_authenticated_url_injects_pat_only_for_bare_https():
    assert (
        repo_service._authenticated_url("https://github.com/o/r.git", "TOKEN")
        == "https://TOKEN@github.com/o/r.git"
    )
    # No PAT → unchanged; ssh → unchanged; already-credentialed → unchanged.
    assert repo_service._authenticated_url("https://github.com/o/r.git", "") == "https://github.com/o/r.git"
    assert repo_service._authenticated_url("git@github.com:o/r.git", "T") == "git@github.com:o/r.git"
    assert (
        repo_service._authenticated_url("https://u@dev.azure.com/o/p/_git/r", "T")
        == "https://u@dev.azure.com/o/p/_git/r"
    )


def test_redact_hides_credentials():
    assert repo_service._redact("https://TOKEN@github.com/o/r.git") == "https://***@github.com/o/r.git"
    assert "TOKEN" not in repo_service._redact("https://TOKEN@github.com/o/r.git")


def test_repo_pat_comes_from_project_repository_connection(db_session):
    """The clone PAT is the project's bound repository connection's PAT (ADR 0006)."""
    from app import crypto
    from app.models.project_config import ProjectConfig
    from app.models.provider_connection import ProviderConnection

    gh = ProviderConnection(
        kind="github", name="GitHub", connected=True,
        config={"org": "acme"}, secrets={"pat": crypto.encrypt("gh-token")},
    )
    db_session.add(gh)
    db_session.flush()
    db_session.add(
        ProjectConfig(key="Surency Platform", name="Surency Platform", repository_connection_id=gh.id)
    )
    db_session.commit()

    assert repo_service._repo_pat_for_project(db_session, "Surency Platform") == "gh-token"


def test_repo_pat_empty_when_no_repository_connection(db_session):
    # Un-bound project with no repository connection degrades to an empty PAT.
    assert repo_service._repo_pat_for_project(db_session, "Nope") == ""


def test_resolve_prefers_existing_local_path(db_session, tmp_path):
    from app.models.project_config import ProjectConfig

    cfg = ProjectConfig(key="P", local_repo_path=str(tmp_path), repo_url="https://github.com/o/r.git")
    # An existing local dir short-circuits before any network/clone attempt.
    assert repo_service.resolve_repo_path(db_session, "P", cfg) == str(tmp_path)


def test_resolve_returns_none_without_any_source(db_session):
    from app.models.project_config import ProjectConfig

    cfg = ProjectConfig(key="P", local_repo_path="", repo_url="")
    assert repo_service.resolve_repo_path(db_session, "P", cfg, repo="") is None
