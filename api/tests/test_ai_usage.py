"""Tests for Claude usage recording + aggregation (/ai/stats)."""

from __future__ import annotations

from app.services import ai_usage_service, claude_cli


def test_record_then_stats_aggregates(workspace_dir, monkeypatch):
    # Avoid spawning the real `claude --version` subprocess.
    monkeypatch.setattr(claude_cli, "is_available", lambda: True)

    model = ai_usage_service._current_model()  # default "claude-sonnet-5"
    ai_usage_service.record(
        model=model,
        input_tokens=100,
        output_tokens=200,
        cache_read=1000,
        cache_write=50,
        cost_usd=0.25,
        duration_ms=1200,
        action="Analyze SUR-1",
    )
    ai_usage_service.record(
        model=model,
        input_tokens=50,
        output_tokens=100,
        cache_read=500,
        cache_write=10,
        cost_usd=0.75,
        duration_ms=800,
        action="Generate cases",
    )

    s = ai_usage_service.stats()

    # Contract keys present.
    assert set(s) == {
        "model", "modelLabel", "operational", "ctxWindow", "requestsToday",
        "avgLatencyMs", "costMonth", "weekTokens", "weekBudget", "weekResetsAt",
        "breakdown",
    }
    assert set(s["breakdown"]) == {"input", "output", "cacheRead", "cacheWrite"}

    assert s["requestsToday"] == 2
    assert s["avgLatencyMs"] == 1000  # (1200 + 800) / 2
    assert s["costMonth"] == 1.0  # 0.25 + 0.75
    # weekTokens = all-model total of every token kind this ISO week.
    assert s["weekTokens"] == 100 + 200 + 1000 + 50 + 50 + 100 + 500 + 10
    assert s["breakdown"] == {
        "input": 150, "output": 300, "cacheRead": 1500, "cacheWrite": 60,
    }
    assert s["operational"] is True
    assert s["modelLabel"] == "Claude Sonnet 5"
    assert s["ctxWindow"] == "200K"
    assert s["weekResetsAt"].endswith("T00:00:00Z")
