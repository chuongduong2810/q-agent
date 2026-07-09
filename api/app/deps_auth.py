"""Auth FastAPI dependencies + cookie helpers (ADR 0007).

- :func:`require_user` — decode the bearer access token, load the active user.
  401s when no/invalid token — for routes that must be authenticated.
- :func:`require_role` — factory that additionally enforces a role.
- :func:`require_admin` — admin-only shortcut (401 unauthenticated, 403 non-admin).
- :func:`current_user` — best-effort variant used by ownership scoping (#91):
  never raises, so routers not yet migrated to per-user filtering stay usable.
- Cookie helpers set/clear the refresh (HttpOnly) + csrf (readable) cookies. The
  ``Secure`` flag is gated on ``settings.cookie_secure`` so http-localhost dev
  works while production behind HTTPS stays secure.
"""

from __future__ import annotations

from fastapi import Depends, HTTPException, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models.user import ROLE_ADMIN, User
from app.services import auth_service

REFRESH_COOKIE = "qagent_refresh"
CSRF_COOKIE = "qagent_csrf"
CSRF_HEADER = "X-CSRF-Token"

_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(status_code=401, detail=detail)


def require_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the current active user from the Authorization: Bearer token."""
    if credentials is None or not credentials.credentials:
        raise _unauthorized()
    try:
        payload = auth_service.decode_access_token(credentials.credentials)
    except auth_service.AuthError as exc:
        raise _unauthorized(str(exc)) from exc
    user = db.get(User, int(payload.get("sub", 0) or 0))
    if user is None or not user.is_active:
        raise _unauthorized("User not found or inactive")
    # Stash the sid so handlers (logout, sessions) can reach the current session.
    user._sid = payload.get("sid")  # type: ignore[attr-defined]
    return user


def require_role(role: str):
    """Dependency factory: 403 unless the current user has ``role``."""

    def _dep(user: User = Depends(require_user)) -> User:
        if user.role != role:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user

    return _dep


def require_admin(user: User = Depends(require_user)) -> User:
    """Dependency for admin-only routes (member management, #94).

    401s (via :func:`require_user`) when there's no/invalid bearer token, 403s
    when the authenticated user isn't an admin. Equivalent to
    ``require_role(ROLE_ADMIN)`` but named for call-site clarity.
    """
    if user.role != ROLE_ADMIN:
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return user


def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User | None:
    """Best-effort resolve the current user for ownership scoping (#91).

    Unlike :func:`require_user`, this **never raises** — it returns ``None``
    when there's no bearer token, the token is invalid/expired, or the user
    can't be found/is inactive.

    # BRIDGE (#91): callers (``app.services.ownership``) treat ``None`` as
    "no scoping" so routes not yet migrated to per-user filtering (#92/#93),
    and the whole test suite (which runs with ``auth_required`` off), keep
    working unchanged. Remove this bridge in the cleanup issue (#98) once
    every route requires an authenticated user.
    """
    if credentials is None or not credentials.credentials:
        return None
    try:
        payload = auth_service.decode_access_token(credentials.credentials)
    except auth_service.AuthError:
        return None
    user = db.get(User, int(payload.get("sub", 0) or 0))
    if user is None or not user.is_active:
        return None
    return user


# ---------------------------------------------------------------- cookies
def set_auth_cookies(response: Response, *, refresh_token: str, csrf_token: str, remember: bool) -> None:
    max_age = int(
        (auth_service.REFRESH_TTL_REMEMBER if remember else auth_service.REFRESH_TTL_DEFAULT).total_seconds()
    )
    response.set_cookie(
        REFRESH_COOKIE,
        refresh_token,
        max_age=max_age,
        httponly=True,
        secure=settings.cookie_secure,
        samesite="lax",
        path="/auth",
    )
    response.set_cookie(
        CSRF_COOKIE,
        csrf_token,
        max_age=max_age,
        httponly=False,  # readable by the SPA so it can echo it in X-CSRF-Token
        secure=settings.cookie_secure,
        samesite="lax",
        path="/",
    )


def clear_auth_cookies(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path="/auth")
    response.delete_cookie(CSRF_COOKIE, path="/")


def read_refresh_cookie(request: Request) -> str | None:
    return request.cookies.get(REFRESH_COOKIE)


def read_csrf_cookie(request: Request) -> str | None:
    return request.cookies.get(CSRF_COOKIE)
