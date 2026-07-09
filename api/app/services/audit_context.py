"""Per-request audit actor (ADR 0007, #79).

The authenticated user for the current request is stashed in a ContextVar so
``audit_service.record`` can attribute events to a real person instead of the
legacy ``"You"`` default — without threading the user through every call site.

``bind_audit_actor`` is a FastAPI dependency (attached to every router in
``main``); it runs inside the endpoint's request context, so the value is
visible to synchronous ``record()`` calls made while handling the request.
Background-thread work (runs) does not inherit the context and falls back to the
actor-type default, which is fine until ownership scoping (plan Phase 3).
"""

from __future__ import annotations

from contextvars import ContextVar

from fastapi import Request

from app.services import auth_service

_actor: ContextVar[str | None] = ContextVar("audit_actor", default=None)


def set_actor(label: str | None) -> None:
    _actor.set(label)


def get_actor() -> str | None:
    return _actor.get()


async def bind_audit_actor(request: Request) -> None:
    """Record the authenticated user as this request's audit actor. No-op when
    the request is unauthenticated (e.g. auth disabled, or a public endpoint)."""
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return
    try:
        claims = auth_service.decode_access_token(header[7:].strip())
    except Exception:  # noqa: BLE001 - never block a request on actor binding
        return
    label = (claims.get("name") or "").strip() or claims.get("email")
    if label:
        set_actor(label)
