"""Projects router.

Endpoints to implement:
  GET  /projects                 -> list[ProjectOut]
  POST /projects/refresh          -> list[ProjectOut]   (pull projects from connected providers)
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app import crypto
from app.db import get_db
from app.models.project import Project
from app.models.provider import Provider
from app.schemas import ProjectOut
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderError

router = APIRouter(prefix="/projects", tags=["projects"])


@router.get("", response_model=list[ProjectOut])
def list_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    return [ProjectOut.model_validate(p) for p in db.query(Project).all()]


@router.post("/refresh", response_model=list[ProjectOut])
def refresh_projects(db: Session = Depends(get_db)) -> list[ProjectOut]:
    """Pull projects from every connected provider's adapter and upsert Project rows."""
    providers = db.query(Provider).filter(Provider.connected.is_(True)).all()

    for provider in providers:
        decrypted_secrets = {
            key: crypto.decrypt(value) for key, value in (provider.secrets or {}).items()
        }
        try:
            adapter = get_adapter(provider.kind, provider.config or {}, decrypted_secrets)
            fetched = adapter.list_projects()
        except ProviderError:
            continue

        for item in fetched:
            external_id = str(item.get("external_id", ""))
            if not external_id:
                continue
            existing = (
                db.query(Project)
                .filter(Project.provider_kind == provider.kind, Project.external_id == external_id)
                .first()
            )
            if existing:
                existing.name = item.get("name", existing.name)
                existing.active = True
                existing.meta = {k: v for k, v in item.items() if k not in ("external_id", "name")}
            else:
                db.add(
                    Project(
                        provider_kind=provider.kind,
                        external_id=external_id,
                        name=item.get("name", external_id),
                        active=True,
                        meta={k: v for k, v in item.items() if k not in ("external_id", "name")},
                    )
                )

    db.commit()
    return [ProjectOut.model_validate(p) for p in db.query(Project).all()]
