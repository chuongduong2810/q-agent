"""Owner-scoped path building for project-keyed artifacts (ADR 0009 §1, #118).

Proves knowledge / repos / auth artifacts land under the owner's scope
(``users/<id>/…``) or the shared namespace (``shared/…`` when ``owner_id`` is
None), rather than the legacy flat ``settings.*_dir``. Git/Claude are never
invoked — repo tests stub ``_run_git`` so no real clone runs.
"""

from __future__ import annotations

from pathlib import Path

from app.models.knowledge import ProjectKnowledge
from app.services import knowledge_service, project_config_service, repo_service


# --------------------------------------------------------------- knowledge
def test_write_knowledge_files_scoped_under_owner(app_env):
    row = ProjectKnowledge(
        key="Surency Platform::web",
        project_key="Surency Platform",
        name="Surency",
        repo="web",
        owner_id=7,
        knowledge={"stack": ["React"]},
    )
    out = knowledge_service.write_knowledge_files(row)
    assert Path(out).as_posix().endswith("users/7/knowledge/Surency-Platform/web")
    assert (Path(out) / "knowledge.json").exists()
    assert (Path(out) / "knowledge.md").exists()


def test_write_knowledge_files_shared_when_owner_none(app_env):
    row = ProjectKnowledge(
        key="Surency Platform::web",
        project_key="Surency Platform",
        name="Surency",
        repo="web",
        owner_id=None,
        knowledge={"stack": ["React"]},
    )
    out = knowledge_service.write_knowledge_files(row)
    assert Path(out).as_posix().endswith("shared/knowledge/Surency-Platform/web")


# --------------------------------------------------------------- repos
def test_materialize_remote_dest_scoped_by_owner(db_session, monkeypatch):
    """The clone destination nests under the owner's scoped repos dir."""
    monkeypatch.setattr(repo_service, "_run_git", lambda args: True)

    owned = repo_service.materialize_remote(
        db_session, "Surency Platform", "https://github.com/o/r.git", owner_id=7
    )
    assert owned is not None
    assert Path(owned).as_posix().endswith("users/7/repos/Surency-Platform")

    shared = repo_service.materialize_remote(
        db_session, "Surency Platform", "https://github.com/o/r.git", owner_id=None
    )
    assert Path(shared).as_posix().endswith("shared/repos/Surency-Platform")


def test_materialize_remote_per_repo_subdir_scoped_by_owner(db_session, monkeypatch):
    monkeypatch.setattr(repo_service, "_run_git", lambda args: True)
    path = repo_service.materialize_remote(
        db_session, "Surency Platform", "https://github.com/o/r.git",
        repo_name="web", owner_id=7,
    )
    assert Path(path).as_posix().endswith("users/7/repos/Surency-Platform/web")


# --------------------------------------------------------------- auth
def test_auth_path_scoped_by_owner(app_env):
    owned = project_config_service.auth_path("Surency Platform", 7)
    assert owned.as_posix().endswith("users/7/auth/Surency-Platform/storageState.json")

    shared = project_config_service.auth_path("Surency Platform", None)
    assert shared.as_posix().endswith("shared/auth/Surency-Platform/storageState.json")


def test_session_path_is_scoped_sibling_of_auth_path(app_env):
    session = project_config_service.session_path("Surency Platform", 7)
    assert session.as_posix().endswith("users/7/auth/Surency-Platform/sessionStorage.json")
    # Defaults to the shared namespace when no owner is given.
    default = project_config_service.session_path("Surency Platform")
    assert default.as_posix().endswith("shared/auth/Surency-Platform/sessionStorage.json")
