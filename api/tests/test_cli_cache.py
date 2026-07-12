"""is_available() TTL caching (app.services.claude_cli, #180)."""

from __future__ import annotations

from app.services import claude_cli


def test_is_available_is_cached_within_ttl(monkeypatch):
    """A second call within the TTL is served from cache — no extra subprocess."""
    claude_cli._is_available_cache = None
    calls = {"n": 0}

    class _Proc:
        returncode = 0

    def _fake_run(*_a, **_k):
        calls["n"] += 1
        return _Proc()

    monkeypatch.setattr(claude_cli.subprocess, "run", _fake_run)
    try:
        assert claude_cli.is_available() is True
        assert claude_cli.is_available() is True  # cached
        assert calls["n"] == 1
    finally:
        claude_cli._is_available_cache = None  # don't leak the cache into other tests
