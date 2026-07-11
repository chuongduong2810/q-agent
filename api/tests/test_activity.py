"""Tests for Claude CLI activity observability."""

from __future__ import annotations

import json

from conftest import FakePopen

from app.services import activity, claude_cli


def test_run_prompt_records_activity(monkeypatch, shared_claude_credential):
    monkeypatch.setattr(
        claude_cli.subprocess,
        "Popen",
        lambda *a, **k: FakePopen(returncode=0, stdout=json.dumps({"result": "ok"}), stderr=""),
    )
    out = claude_cli.run_prompt("hi", label="Analyze SUR-1", skill="requirement-analyst")
    assert out == "ok"
    recent = activity.snapshot()["recent"]
    top = recent[0]
    assert top["label"] == "Analyze SUR-1"
    assert top["status"] == "ok"
    assert "durationMs" in top


def test_run_prompt_records_failure(monkeypatch, shared_claude_credential):
    def boom(*a, **k):
        raise FileNotFoundError("no claude")

    monkeypatch.setattr(claude_cli.subprocess, "Popen", boom)
    try:
        claude_cli.run_prompt("hi", label="Failing call")
    except claude_cli.ClaudeError:
        pass
    top = activity.snapshot()["recent"][0]
    assert top["label"] == "Failing call"
    assert top["status"] == "error"


def test_ai_activity_endpoint(client):
    resp = client.get("/ai/activity")
    assert resp.status_code == 200
    body = resp.json()
    assert "running" in body and "recent" in body
