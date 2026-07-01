"""Provider adapters (Azure DevOps / Jira / GitHub).

The concrete adapters are implemented in their own modules and registered here.
Callers resolve an adapter by provider kind via :func:`get_adapter`.
"""

from __future__ import annotations

from app.services.adapters.base import ProviderAdapter, ProviderError

# Concrete adapters register themselves on import. Kept lazy to avoid import
# cycles during app bootstrap; resolved on first use.
_REGISTRY: dict[str, type[ProviderAdapter]] = {}


def register(kind: str, cls: type[ProviderAdapter]) -> None:
    _REGISTRY[kind] = cls


def get_adapter(kind: str, config: dict, secrets: dict) -> ProviderAdapter:
    """Instantiate the adapter for ``kind`` with decrypted config + secrets."""
    if not _REGISTRY:
        _load_builtin()
    if kind not in _REGISTRY:
        raise ProviderError(f"No adapter registered for provider '{kind}'")
    return _REGISTRY[kind](config=config, secrets=secrets)


def _load_builtin() -> None:
    # Import concrete adapters so they self-register. Implemented by the
    # providers feature module.
    try:
        from app.services.adapters import azure_devops, github, jira  # noqa: F401
    except ImportError:
        pass


__all__ = ["ProviderAdapter", "ProviderError", "get_adapter", "register"]
