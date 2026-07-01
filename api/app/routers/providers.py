"""Providers + Settings router.

Endpoints to implement (see docs/API-CONTRACT.md):
  GET    /providers                       -> list[ProviderOut]
  GET    /providers/{kind}                -> ProviderOut
  PUT    /providers/{kind}                -> ProviderOut          (save config + secrets, encrypted)
  POST   /providers/{kind}/test           -> TestConnectionResult (live adapter check)
  GET    /settings                        -> SettingsOut
  PUT    /settings                        -> SettingsOut

Note: `/settings` is not nested under `/providers`, so this router has no
prefix — provider paths spell out `/providers` explicitly. `app/main.py`
includes this single `router` object.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app import crypto
from app.db import get_db
from app.logging import logger
from app.models.provider import PROVIDER_KINDS, Provider
from app.schemas import (
    ProviderFieldsIn,
    ProviderOut,
    SettingsOut,
    SettingsUpdate,
    SprintOut,
    TestConnectionResult,
)
from app.services import settings_store
from app.services.adapters import get_adapter
from app.services.adapters.base import ProviderError

router = APIRouter(tags=["providers"])


def _validate_kind(kind: str) -> None:
    if kind not in PROVIDER_KINDS:
        raise HTTPException(status_code=404, detail=f"Unknown provider kind '{kind}'")


def _to_provider_out(provider: Provider) -> ProviderOut:
    """Build a ProviderOut with secrets replaced by their field names only."""
    return ProviderOut(
        id=provider.id,
        kind=provider.kind,
        name=provider.name,
        connected=provider.connected,
        config=provider.config or {},
        secret_fields=sorted((provider.secrets or {}).keys()),
        last_sync=provider.last_sync,
    )


@router.get("/providers", response_model=list[ProviderOut])
def list_providers(db: Session = Depends(get_db)) -> list[ProviderOut]:
    providers = db.query(Provider).all()
    return [_to_provider_out(p) for p in providers]


@router.get("/providers/{kind}", response_model=ProviderOut)
def get_provider(kind: str, db: Session = Depends(get_db)) -> ProviderOut:
    _validate_kind(kind)
    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{kind}' is not configured")
    return _to_provider_out(provider)


@router.put("/providers/{kind}", response_model=ProviderOut)
def upsert_provider(kind: str, body: ProviderFieldsIn, db: Session = Depends(get_db)) -> ProviderOut:
    """Save non-secret config + encrypt and persist secrets. Upserts the single row per kind."""
    _validate_kind(kind)

    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        provider = Provider(kind=kind, name=kind.upper(), connected=False, config={}, secrets={})
        db.add(provider)

    if body.config:
        provider.config = {**(provider.config or {}), **body.config}
    if body.secrets:
        encrypted = {**(provider.secrets or {})}
        for key, value in body.secrets.items():
            encrypted[key] = crypto.encrypt(value)
        provider.secrets = encrypted

    db.commit()
    db.refresh(provider)
    return _to_provider_out(provider)


@router.post("/providers/{kind}/test", response_model=TestConnectionResult)
def test_provider_connection(kind: str, db: Session = Depends(get_db)) -> TestConnectionResult:
    """Instantiate the live adapter with decrypted config/secrets and probe connectivity."""
    _validate_kind(kind)
    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        raise HTTPException(status_code=404, detail=f"Provider '{kind}' is not configured")

    decrypted_secrets = {key: crypto.decrypt(value) for key, value in (provider.secrets or {}).items()}

    try:
        adapter = get_adapter(kind, provider.config or {}, decrypted_secrets)
        result = adapter.test_connection()
    except ProviderError as exc:
        result = {"ok": False, "message": str(exc), "detail": {}}

    provider.connected = bool(result.get("ok"))
    db.commit()

    return TestConnectionResult(
        ok=result.get("ok", False),
        message=result.get("message", ""),
        detail=result.get("detail", {}) or {},
    )


@router.get("/providers/{kind}/sprints", response_model=list[SprintOut])
def list_provider_sprints(kind: str, db: Session = Depends(get_db)) -> list[SprintOut]:
    """Return the provider's real sprints/iterations for the configured project.

    Resilient: an unconfigured/unsupported provider yields an empty list so the
    sprint picker degrades gracefully rather than erroring the UI.
    """
    _validate_kind(kind)
    provider = db.query(Provider).filter(Provider.kind == kind).first()
    if not provider:
        return []
    decrypted = {key: crypto.decrypt(value) for key, value in (provider.secrets or {}).items()}
    try:
        adapter = get_adapter(kind, provider.config or {}, decrypted)
        sprints = adapter.list_sprints()
    except ProviderError as exc:
        logger.warning("Sprint list for '{}' unavailable: {}", kind, exc)
        return []
    except Exception as exc:  # noqa: BLE001 - upstream/API hiccup shouldn't 500 the picker
        logger.warning("Sprint list for '{}' failed: {}", kind, exc)
        return []
    return [SprintOut.model_validate(s) for s in sprints]


@router.get("/settings", response_model=SettingsOut, tags=["settings"])
def get_settings_endpoint() -> SettingsOut:
    return SettingsOut.model_validate(settings_store.load_settings())


@router.put("/settings", response_model=SettingsOut, tags=["settings"])
def update_settings_endpoint(body: SettingsUpdate) -> SettingsOut:
    updates = body.model_dump(by_alias=False, exclude_none=True)
    # settings_store keys are camelCase to match SettingsOut fields directly.
    camel_updates = {
        "parallel": updates.get("parallel"),
        "retryFlaky": updates.get("retry_flaky"),
        "screenshotOnFail": updates.get("screenshot_on_fail"),
        "video": updates.get("video"),
    }
    saved = settings_store.save_settings(camel_updates)
    return SettingsOut.model_validate(saved)
