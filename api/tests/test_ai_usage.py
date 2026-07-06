"""Tests for /ai/stats — real Claude usage read from local session logs.

These exercise ``claude_usage_reader.read_stats()`` against a crafted transcript
written into a temp ``claude_home``, asserting the NEW contract shape (session /
week windows, breakdown, byModel). The legacy ``ai_usage_service.record`` capture
still exists and is smoke-tested separately.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from app.config import settings as app_settings
from app.services import ai_usage_service, claude_cli, claude_usage_reader

CONTRACT_KEYS = {
    "model", "modelLabel", "operational", "ctxWindow",
    "session", "week", "breakdown", "byModel", "limitsStatus",
}
WINDOW_KEYS = {"costUsd", "tokens", "requests", "resetsAt", "pctUsed", "resetLabel"}


def _iso(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _line(*, mid: str, model: str, ts: datetime, usage: dict) -> str:
    return json.dumps(
        {"uuid": mid, "timestamp": _iso(ts), "message": {"id": mid, "model": model, "usage": usage}}
    )


def _write_transcript(claude_home, lines: list[str]) -> None:
    proj = claude_home / "projects" / "-some-project"
    proj.mkdir(parents=True, exist_ok=True)
    (proj / "session.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")


def _fresh(monkeypatch, claude_home):
    """Point settings at claude_home, force operational, and clear the TTL cache."""
    monkeypatch.setattr(app_settings, "claude_home", claude_home)
    monkeypatch.setattr(claude_cli, "is_available", lambda: True)
    monkeypatch.setattr(claude_usage_reader, "_cache", None)
    # Stub the CLI /usage limit fetch so tests stay deterministic and never spawn `claude`.
    monkeypatch.setattr(claude_usage_reader, "_get_limits", lambda: (None, "unavailable"))


def test_read_stats_new_shape(workspace_dir, tmp_path, monkeypatch):
    claude_home = tmp_path / ".claude"
    now = datetime.now(timezone.utc)
    opus = {"input_tokens": 100, "output_tokens": 200,
            "cache_read_input_tokens": 1000, "cache_creation_input_tokens": 50}
    sonnet = {"input_tokens": 50, "output_tokens": 100,
              "cache_read_input_tokens": 500, "cache_creation_input_tokens": 10}
    old = {"input_tokens": 9999, "output_tokens": 9999,
           "cache_read_input_tokens": 9999, "cache_creation_input_tokens": 9999}
    _write_transcript(claude_home, [
        _line(mid="m-A", model="claude-opus-4-8", ts=now - timedelta(minutes=5), usage=opus),
        # Duplicate of m-A — must be counted once (dedup by message id).
        _line(mid="m-A", model="claude-opus-4-8", ts=now - timedelta(minutes=5), usage=opus),
        _line(mid="m-B", model="claude-sonnet-5", ts=now - timedelta(minutes=9), usage=sonnet),
        # 10 days ago — outside both windows, must be excluded.
        _line(mid="m-D", model="claude-opus-4-8", ts=now - timedelta(days=10), usage=old),
    ])
    _fresh(monkeypatch, claude_home)

    s = claude_usage_reader.read_stats()

    assert set(s) == CONTRACT_KEYS
    assert set(s["session"]) == WINDOW_KEYS
    assert set(s["week"]) == WINDOW_KEYS
    assert set(s["breakdown"]) == {"input", "output", "cacheRead", "cacheWrite"}

    # Operator-selected model (default "claude-sonnet-5") drives model/label/ctx.
    assert s["model"] == "claude-sonnet-5"
    assert s["modelLabel"] == "Claude Sonnet 5"
    assert s["ctxWindow"] == "200K"
    assert s["operational"] is True

    # tokens = input+output+cacheRead+cacheWrite across all models in the window.
    opus_total = 100 + 200 + 1000 + 50
    sonnet_total = 50 + 100 + 500 + 10
    assert s["week"]["tokens"] == opus_total + sonnet_total
    assert s["week"]["requests"] == 2  # m-A (deduped) + m-B, m-D excluded
    assert s["session"]["tokens"] == opus_total + sonnet_total
    assert s["session"]["requests"] == 2
    assert s["week"]["resetsAt"].endswith("T00:00:00Z")
    assert s["session"]["resetsAt"].endswith("Z")

    # breakdown = current model (sonnet-5) week token sums.
    assert s["breakdown"] == {"input": 50, "output": 100, "cacheRead": 500, "cacheWrite": 10}

    # byModel: per-model week sums + cost, sorted by cost desc. Opus costs more.
    assert [m["model"] for m in s["byModel"]] == ["claude-opus-4-8", "claude-sonnet-5"]
    opus_row = s["byModel"][0]
    assert opus_row["input"] == 100  # dedup + exclusion held (not 200, not +9999)
    assert opus_row["cacheRead"] == 1000
    # cost = (100*5 + 200*25 + 1000*0.5 + 50*6.25) / 1e6 = 0.0063125 -> 0.01
    assert opus_row["costUsd"] == 0.01
    assert s["byModel"][0]["costUsd"] >= s["byModel"][1]["costUsd"]


def test_read_stats_missing_home_is_zero(workspace_dir, tmp_path, monkeypatch):
    _fresh(monkeypatch, tmp_path / "does-not-exist")

    s = claude_usage_reader.read_stats()

    assert set(s) == CONTRACT_KEYS
    assert s["week"]["tokens"] == 0
    assert s["week"]["requests"] == 0
    assert s["session"]["tokens"] == 0
    assert s["byModel"] == []
    assert s["breakdown"] == {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}


def test_record_still_writes_a_row(workspace_dir):
    """The legacy per-call capture stays in place (harmless) and must not raise."""
    ai_usage_service.record(
        model="claude-sonnet-5",
        input_tokens=100, output_tokens=200, cache_read=1000, cache_write=50,
        cost_usd=0.25, duration_ms=1200, action="Analyze SUR-1",
    )
    from app import db
    from app.models.claude_usage import ClaudeUsage

    session = db.SessionLocal()
    try:
        assert session.query(ClaudeUsage).count() == 1
    finally:
        session.close()


def test_run_breakdown_groups_by_process_and_isolates_runs(workspace_dir):
    """run_breakdown groups a run's rows by process with correct totals, and a
    run with no recorded usage returns the empty shape."""
    from app import db

    # Run 42: two analyze calls + one generate call (same model).
    ai_usage_service.record(
        model="claude-sonnet-5", input_tokens=1000, output_tokens=500,
        cache_read=200, cache_write=100, cost_usd=0.30, duration_ms=1000,
        action="requirement-analyst", run_id=42,
    )
    ai_usage_service.record(
        model="claude-sonnet-5", input_tokens=2000, output_tokens=1000,
        cache_read=0, cache_write=0, cost_usd=0.70, duration_ms=1000,
        action="requirement-analyst", run_id=42,
    )
    ai_usage_service.record(
        model="claude-sonnet-5", input_tokens=500, output_tokens=500,
        cache_read=0, cache_write=0, cost_usd=0.10, duration_ms=1000,
        action="test-case-generator", run_id=42,
    )
    # A different run's (expensive) call must never leak into run 42.
    ai_usage_service.record(
        model="claude-opus-4-8", input_tokens=9, output_tokens=9,
        cache_read=0, cache_write=0, cost_usd=5.0, duration_ms=1000,
        action="requirement-analyst", run_id=99,
    )

    session = db.SessionLocal()
    try:
        out = ai_usage_service.run_breakdown(session, 42)
        empty = ai_usage_service.run_breakdown(session, 7)
    finally:
        session.close()

    assert out["runId"] == 42
    assert out["modelLabel"] == "Claude Sonnet 5"
    # Processes sorted by cost desc: analyze (1.00) before generate (0.10).
    assert [p["key"] for p in out["processes"]] == ["analyze", "generate"]
    analyze = out["processes"][0]
    assert analyze["name"] == "Analyze"
    assert analyze["meta"] == "requirement-analyst · 2 calls"
    assert analyze["input"] == 3000
    assert analyze["output"] == 1500
    assert analyze["tokens"] == 4800  # 1800 + 3000 (input+output+cacheRead+cacheWrite)
    assert analyze["costUsd"] == 1.0
    assert out["totalCostUsd"] == 1.10
    assert out["totalTokens"] == 5800  # 4800 analyze + 1000 generate

    # A run with no usage returns the empty contract shape.
    assert empty["processes"] == []
    assert empty["modelLabel"] == ""
    assert empty["totalCostUsd"] == 0.0
    assert empty["totalTokens"] == 0
