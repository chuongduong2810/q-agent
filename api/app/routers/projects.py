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
from app.models.knowledge import ProjectKnowledge, compose_key
from app.models.project import Project
from app.models.provider_connection import ProviderConnection
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

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    return [ProjectOut.model_validate(p) for p in db.query(Project).all()]


@router.post("/refresh", response_model=list[ProjectOut])
def refresh_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    """Pull projects from every connected work-item connection and upsert Project rows.

    Each project is stamped with the connection that discovered it
    (``Project.connection_id``) — a convenience reference, not the credential router.
    """
    connections = (
        db.query(ProviderConnection).filter(ProviderConnection.connected.is_(True)).all()
    )

    for connection in connections:
        if connection_service.category_for(connection.kind) != connection_service.WORK_ITEM:
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
            existing = (
                db.query(Project)
                .filter(
                    Project.provider_kind == connection.kind,
                    Project.external_id == external_id,
                )
                .first()
            )
            if existing:
                existing.name = item.get("name", existing.name)
                existing.active = True
                existing.meta = meta
                existing.connection_id = connection.id
            else:
                db.add(
                    Project(
                        provider_kind=connection.kind,
                        external_id=external_id,
                        name=item.get("name", external_id),
                        active=True,
                        connection_id=connection.id,
                        meta=meta,
                    )
                )

    db.commit()
    return [ProjectOut.model_validate(p) for p in db.query(Project).all()]


# ------------------------------------------------------------- Project Knowledge
@router.get("/knowledge", response_model=list[ProjectKnowledgeOut])
def list_knowledge(db: Session = Depends(get_db)) -> list[ProjectKnowledge]:
    """All Project Knowledge Bases (drives the Projects grid's status badges)."""
    return db.query(ProjectKnowledge).all()


@router.get("/{key}/knowledge", response_model=ProjectKnowledgeOut)
def get_knowledge(key: str, db: Session = Depends(get_db)) -> ProjectKnowledge:
    row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == key).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"No knowledge base for project '{key}'")
    return row


@router.post("/{key}/knowledge/build", response_model=ProjectKnowledgeOut)
def build_knowledge(
    key: str, body: KnowledgeBuildRequest, db: Session = Depends(get_db)
) -> ProjectKnowledge:
    """Build (or rebuild) a project's knowledge base via Claude (project-bootstrap)."""
    row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == key).first()
    if not row:
        row = ProjectKnowledge(key=key, project_key=key, name=body.name or key)
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
def get_project_config(key: str, db: Session = Depends(get_db)) -> dict:
    """Return a project's runtime config (test accounts masked)."""
    row = project_config_service.get_config(db, key)
    return project_config_service.public_config(row, key)


@router.put("/{key}/config", response_model=ProjectConfigOut)
def save_project_config(
    key: str, body: ProjectConfigUpdate, db: Session = Depends(get_db)
) -> dict:
    """Create or update a project's runtime config from the Project Details page."""
    patch = body.model_dump(exclude_none=True)
    row = project_config_service.upsert_config(db, key, patch)
    db.commit()
    db.refresh(row)
    return project_config_service.public_config(row, key)


# ---------------------------------------------------------- Manual-login session
@router.get("/{key}/auth", response_model=AuthStateOut)
def get_project_auth(key: str) -> dict:
    """Report whether a project has a saved manual-login session (+ capture time)."""
    return {**project_config_service.auth_state(key), "capturing": playwright_runner.is_capturing(key)}


@router.post("/{key}/auth/capture", response_model=AuthStateOut)
def capture_project_auth(key: str, db: Session = Depends(get_db)) -> dict:
    """Open a headed browser so the operator can log in and save the session.

    Runs the capture in a background thread and returns immediately with
    ``capturing: true`` — the login is long/interactive, so the UI polls
    ``GET /{key}/auth`` for completion. If a capture is already in flight for
    this project, returns the current state without opening a second browser.
    """
    if not playwright_runner.is_capturing(key):
        config = project_config_service.get_config(db, key)
        base_url = (config.base_url if config else "") or ""
        if not base_url:
            raise HTTPException(status_code=400, detail="Set a base URL for the project first.")
        playwright_runner.start_capture(key, base_url)
    return {**project_config_service.auth_state(key), "capturing": playwright_runner.is_capturing(key)}


@router.delete("/{key}/auth", response_model=AuthStateOut)
def clear_project_auth(key: str) -> dict:
    """Delete a project's saved session file, forcing re-capture on the next run."""
    return project_config_service.clear_auth(key)


# --------------------------------------------------------------- Project repos
def _repository_connection_for_project(db: Session, key: str) -> ProviderConnection | None:
    """The project's bound repository connection (ADR 0006), or None."""
    try:
        return connection_service.resolve_repository_for_project(db, key)
    except ProviderError:
        return None


@router.get("/{key}/repos/available", response_model=AvailableReposOut)
def list_available_repos(key: str, db: Session = Depends(get_db)) -> dict:
    """Discover the repositories the project's repository connection exposes."""
    connection = _repository_connection_for_project(db, key)
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
def list_project_repos(key: str, db: Session = Depends(get_db)) -> list[dict]:
    """The project's configured repos, each annotated with its knowledge-base status."""
    config = project_config_service.get_config(db, key)
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
def get_repo_knowledge(key: str, repo: str, db: Session = Depends(get_db)) -> ProjectKnowledge:
    row = (
        db.query(ProjectKnowledge)
        .filter(ProjectKnowledge.key == compose_key(key, repo))
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail=f"No knowledge base for repo '{repo}'")
    return row


@router.post("/{key}/repos/{repo}/knowledge/build", response_model=ProjectKnowledgeOut)
def build_repo_knowledge(
    key: str, repo: str, body: KnowledgeBuildRequest, db: Session = Depends(get_db)
) -> ProjectKnowledge:
    """Build (or rebuild) the per-repo knowledge base for one of a project's repos."""
    config = project_config_service.get_config(db, key)
    repos = project_config_service.get_repos(config)
    repo_entry = next((r for r in repos if r["name"] == repo), None)
    if repo_entry is None:
        raise HTTPException(
            status_code=404, detail=f"Repo '{repo}' is not configured for project '{key}'"
        )

    row_key = compose_key(key, repo)
    row = db.query(ProjectKnowledge).filter(ProjectKnowledge.key == row_key).first()
    if row is None:
        row = ProjectKnowledge(key=row_key, project_key=key, name=key, repo=repo)
        db.add(row)
    row.project_key = key
    row.repo = repo
    if body.provider is not None:
        row.provider = body.provider
    elif not row.provider:
        connection = _repository_connection_for_project(db, key)
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
