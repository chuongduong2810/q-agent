"""Projects router.

Endpoints to implement:
  GET  /projects                 -> list[ProjectOut]
  POST /projects/refresh          -> list[ProjectOut]   (pull projects from connected providers)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crypto
from app.db import get_db
from app.deps_auth import current_user
from app.models.knowledge import ProjectKnowledge, compose_key
from app.models.project import Project
from app.models.provider_connection import ProviderConnection
from app.models.user import User
from app.schemas import (
    AuthStateOut,
    AvailableReposOut,
    KnowledgeBuildRequest,
    ProjectConfigOut,
    ProjectConfigUpdate,
    ProjectKnowledgeOut,
    ProjectOut,
    RepoKnowledgeOut,
)
from app.services import (
    connection_service,
    knowledge_service,
    playwright_runner,
    project_config_service,
)
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderError
from app.services.ownership import check_owned_or_404, owned, stamp_owner

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(
    db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[ProjectOut]:
    """Projects scoped to ``user`` (#93 — private per-user data)."""
    return [ProjectOut.model_validate(p) for p in owned(db.query(Project), Project, user).all()]


@router.post("/refresh", response_model=list[ProjectOut])
def refresh_projects(
    db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[ProjectOut]:
    """Pull projects from every connected work-item connection and upsert Project rows.

    Each project is stamped with the connection that discovered it
    (``Project.connection_id``) — a convenience reference, not the credential router.
    Both the source connections and the upserted projects are scoped to ``user``
    (#93) — a user only ever refreshes from, and creates, their own data.
    """
    connections = owned(
        db.query(ProviderConnection).filter(ProviderConnection.connected.is_(True)),
        ProviderConnection,
        user,
    ).all()

    for connection in connections:
        if connection_service.WORK_ITEM not in connection_service.categories_for(connection.kind):
            continue
        decrypted_secrets = {
            key: crypto.decrypt(value) for key, value in (connection.secrets or {}).items()
        }
        try:
            adapter = get_adapter(connection.kind, connection.config or {}, decrypted_secrets)
            fetched = adapter.list_projects()
        except ProviderError:
            continue

        for item in fetched:
            external_id = str(item.get("external_id", ""))
            if not external_id:
                continue
            meta = {k: v for k, v in item.items() if k not in ("external_id", "name")}
            existing = owned(
                db.query(Project).filter(
                    Project.provider_kind == connection.kind,
                    Project.external_id == external_id,
                ),
                Project,
                user,
            ).first()
            if existing:
                existing.name = item.get("name", existing.name)
                existing.active = True
                existing.meta = meta
                existing.connection_id = connection.id
            else:
                db.add(
                    stamp_owner(
                        Project(
                            provider_kind=connection.kind,
                            external_id=external_id,
                            name=item.get("name", external_id),
                            active=True,
                            connection_id=connection.id,
                            meta=meta,
                        ),
                        user,
                    )
                )

    db.commit()
    return [ProjectOut.model_validate(p) for p in owned(db.query(Project), Project, user).all()]


# ------------------------------------------------------------- Project Knowledge
@router.get("/knowledge", response_model=list[ProjectKnowledgeOut])
def list_knowledge(
    db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[ProjectKnowledge]:
    """All Project Knowledge Bases (drives the Projects grid's status badges).

    Scoped to ``user`` (#93 — private per-user data).
    """
    return owned(db.query(ProjectKnowledge), ProjectKnowledge, user).all()


@router.get("/{key}/knowledge", response_model=ProjectKnowledgeOut)
def get_knowledge(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> ProjectKnowledge:
    row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"No knowledge base for project '{key}'")
    check_owned_or_404(row, user, not_found=f"No knowledge base for project '{key}'")
    return row


@router.post("/{key}/knowledge/build", response_model=ProjectKnowledgeOut)
def build_knowledge(
    key: str,
    body: KnowledgeBuildRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> ProjectKnowledge:
    """Build (or rebuild) a project's knowledge base via Claude (project-bootstrap).

    Scoped to ``user`` (#93): rebuilding another user's existing knowledge base
    404s; a new row is stamped with the current user's ownership.
    """
    row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == key).first()
    check_owned_or_404(row, user, not_found=f"No knowledge base for project '{key}'")
    if not row:
        row = stamp_owner(ProjectKnowledge(key=key, project_key=key, name=body.name or key), user)
        db.add(row)
    row.project_key = row.project_key or key
    if body.name:
        row.name = body.name
    if body.provider is not None:
        row.provider = body.provider
    if body.repo is not None:
        row.repo = body.repo
    if body.framework:
        row.framework = body.framework

    # Build asynchronously — repo clone + Claude traversal can take minutes, which
    # would otherwise block the request past the CLI timeout. Mark 'indexing' so the
    # UI reflects progress on return and cannot re-trigger while one is running.
    if row.status != "indexing":
        row.status = "indexing"
        row.last_error = ""
        db.commit()
        db.refresh(row)
        knowledge_service.start_build(row.key)
    return row


# --------------------------------------------------------------- Project Config
@router.get("/{key}/config", response_model=ProjectConfigOut)
def get_project_config(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Return a project's runtime config (test accounts masked).

    Scoped to ``user`` (#93 — private per-user data): another user's config 404s.
    """
    row = project_config_service.get_config(db, key)
    check_owned_or_404(row, user, not_found=f"Project config '{key}' not found")
    return project_config_service.public_config(row, key)


@router.put("/{key}/config", response_model=ProjectConfigOut)
def save_project_config(
    key: str,
    body: ProjectConfigUpdate,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> dict:
    """Create or update a project's runtime config from the Project Details page.

    Scoped to ``user`` (#93): updating another user's config 404s; a newly
    created config is stamped with the current user's ownership.
    """
    existing = project_config_service.get_config(db, key)
    check_owned_or_404(existing, user, not_found=f"Project config '{key}' not found")
    patch = body.model_dump(exclude_none=True)
    row = project_config_service.upsert_config(db, key, patch)
    if existing is None:
        stamp_owner(row, user)
    db.commit()
    db.refresh(row)
    return project_config_service.public_config(row, key)


# ---------------------------------------------------------- Manual-login session
@router.get("/{key}/auth", response_model=AuthStateOut)
def get_project_auth(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Report whether a project has a saved manual-login session (+ capture time).

    Scoped to ``user`` (#93) via the underlying project config's ownership.
    """
    config = project_config_service.get_config(db, key)
    check_owned_or_404(config, user, not_found=f"Project config '{key}' not found")
    owner_id = config.owner_id if config else None
    return {
        **project_config_service.auth_state(key, owner_id),
        "capturing": playwright_runner.is_capturing(key),
    }


@router.post("/{key}/auth/capture", response_model=AuthStateOut)
def capture_project_auth(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Open a headed browser so the operator can log in and save the session.

    Runs the capture in a background thread and returns immediately with
    ``capturing: true`` — the login is long/interactive, so the UI polls
    ``GET /{key}/auth`` for completion. If a capture is already in flight for
    this project, returns the current state without opening a second browser.
    Scoped to ``user`` (#93) via the underlying project config's ownership.
    """
    config = project_config_service.get_config(db, key)
    check_owned_or_404(config, user, not_found=f"Project config '{key}' not found")
    owner_id = config.owner_id if config else None
    if not playwright_runner.is_capturing(key):
        base_url = (config.base_url if config else "") or ""
        if not base_url:
            raise HTTPException(status_code=400, detail="Set a base URL for the project first.")
        playwright_runner.start_capture(key, base_url, owner_id=owner_id)
    return {
        **project_config_service.auth_state(key, owner_id),
        "capturing": playwright_runner.is_capturing(key),
    }


@router.delete("/{key}/auth", response_model=AuthStateOut)
def clear_project_auth(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Delete a project's saved session file, forcing re-capture on the next run.

    Scoped to ``user`` (#93) via the underlying project config's ownership.
    """
    config = project_config_service.get_config(db, key)
    check_owned_or_404(config, user, not_found=f"Project config '{key}' not found")
    return project_config_service.clear_auth(key, config.owner_id if config else None)


# --------------------------------------------------------------- Project repos
def _repository_connection_for_project(
    db: Session, key: str, owner_id: int | None = None
) -> ProviderConnection | None:
    """The project's bound repository connection (ADR 0006), or None.

    ``owner_id`` (#93 — private per-user data) restricts resolution to that
    user's own connections.
    """
    try:
        return connection_service.resolve_repository_for_project(db, key, owner_id=owner_id)
    except ProviderError:
        return None


@router.get("/{key}/repos/available", response_model=AvailableReposOut)
def list_available_repos(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> dict:
    """Discover the repositories the project's repository connection exposes.

    Scoped to ``user`` (#93): another user's project config 404s, and the
    repository connection is resolved from the current user's own connections.
    """
    check_owned_or_404(
        project_config_service.get_config(db, key), user, not_found=f"Project config '{key}' not found"
    )
    connection = _repository_connection_for_project(db, key, owner_id=user.id if user else None)
    if not connection:
        return {"provider": "", "repos": [], "error": "No repository connection is bound to this project"}
    secrets = {k: crypto.decrypt(v) for k, v in (connection.secrets or {}).items()}
    try:
        adapter = get_adapter(connection.kind, connection.config or {}, secrets)
        repos = adapter.list_repos()
    except ProviderError as exc:
        return {"provider": connection.kind, "repos": [], "error": str(exc)}
    except Exception as exc:  # noqa: BLE001 - never 500 the picker on an upstream hiccup
        return {"provider": connection.kind, "repos": [], "error": f"Could not list repos: {exc}"}
    return {"provider": connection.kind, "repos": repos, "error": ""}


@router.get("/{key}/repos", response_model=list[RepoKnowledgeOut])
def list_project_repos(
    key: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> list[dict]:
    """The project's configured repos, each annotated with its knowledge-base status.

    Scoped to ``user`` (#93): another user's project config 404s.
    """
    config = project_config_service.get_config(db, key)
    check_owned_or_404(config, user, not_found=f"Project config '{key}' not found")
    repos = project_config_service.get_repos(config)
    out: list[dict] = []
    for repo in repos:
        kn = (
            db.query(ProjectKnowledge)
            .filter(ProjectKnowledge.key == compose_key(key, repo["name"]))
            .first()
        )
        out.append(
            {
                "name": repo["name"],
                "repoUrl": repo.get("repo_url", ""),
                "defaultBranch": repo.get("default_branch", ""),
                "localRepoPath": repo.get("local_repo_path", ""),
                "default": repo.get("default", False),
                "status": kn.status if kn else "not_indexed",
                "confidence": kn.confidence if kn else 0,
                "version": kn.version if kn else "v1",
                "needsRefresh": kn.needs_refresh if kn else False,
                "lastIndexed": kn.last_indexed if kn else None,
                "docPath": kn.doc_path if kn else "",
                "lastError": kn.last_error if kn else "",
            }
        )
    return out


@router.get("/{key}/repos/{repo}/knowledge", response_model=ProjectKnowledgeOut)
def get_repo_knowledge(
    key: str, repo: str, db: Session = Depends(get_db), user: User | None = Depends(current_user)
) -> ProjectKnowledge:
    """Scoped to ``user`` (#93): another user's per-repo knowledge base 404s."""
    row = (
        db.query(ProjectKnowledge)
        .filter(ProjectKnowledge.key == compose_key(key, repo))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"No knowledge base for repo '{repo}'")
    check_owned_or_404(row, user, not_found=f"No knowledge base for repo '{repo}'")
    return row


@router.post("/{key}/repos/{repo}/knowledge/build", response_model=ProjectKnowledgeOut)
def build_repo_knowledge(
    key: str,
    repo: str,
    body: KnowledgeBuildRequest,
    db: Session = Depends(get_db),
    user: User | None = Depends(current_user),
) -> ProjectKnowledge:
    """Build (or rebuild) the per-repo knowledge base for one of a project's repos.

    Scoped to ``user`` (#93): another user's project config or existing
    per-repo knowledge base 404s; a new row is stamped with the current user's
    ownership.
    """
    config = project_config_service.get_config(db, key)
    check_owned_or_404(config, user, not_found=f"Project config '{key}' not found")
    repos = project_config_service.get_repos(config)
    repo_entry = next((r for r in repos if r["name"] == repo), None)
    if repo_entry is None:
        raise HTTPException(
            status_code=404, detail=f"Repo '{repo}' is not configured for project '{key}'"
        )

    row_key = compose_key(key, repo)
    row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == row_key).first()
    check_owned_or_404(row, user, not_found=f"No knowledge base for repo '{repo}'")
    if row is None:
        row = stamp_owner(ProjectKnowledge(key=row_key, project_key=key, name=key, repo=repo), user)
        db.add(row)
    row.project_key = key
    row.repo = repo
    if body.provider is not None:
        row.provider = body.provider
    elif not row.provider:
        connection = _repository_connection_for_project(db, key, owner_id=user.id if user else None)
        row.provider = connection.kind if connection else ""
    if body.framework:
        row.framework = body.framework

    # Build asynchronously (repo clone + Claude traversal can take minutes). Mark
    # the row 'indexing' so the UI reflects progress and can't double-trigger.
    if row.status != "indexing":
        row.status = "indexing"
        row.last_error = ""
        db.commit()
        db.refresh(row)
        knowledge_service.start_build(row_key)
    return row
