"""Tests for dedicated-skill injection into Claude CLI actions."""

from __future__ import annotations

import json

from conftest import FakePopen

from app.services import claude_cli, skills


def test_load_skill_returns_methodology():
    text = skills.load_skill(skills.REQUIREMENT_ANALYST)
    assert text and "Requirement Analyst" in text
    assert "dedicated Q-Agent skill" in text  # our injected preamble


def test_load_skill_missing_returns_none():
    assert skills.load_skill("does-not-exist-skill") is None


def test_run_prompt_injects_skill_as_system(monkeypatch, shared_claude_credential):
    captured = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        return FakePopen(returncode=0, stdout=json.dumps({"result": "ok"}), stderr="")

    monkeypatch.setattr(claude_cli.subprocess, "Popen", fake_popen)

    out = claude_cli.run_prompt("hello", skill=skills.TEST_CASE_GENERATOR)
    assert out == "ok"
    cmd = captured["cmd"]
    assert "--append-system-prompt" in cmd
    injected = cmd[cmd.index("--append-system-prompt") + 1]
    assert "Test Case Generator" in injected


def test_run_prompt_merges_skill_and_explicit_system(monkeypatch, shared_claude_credential):
    captured = {}

    def fake_popen(cmd, **kwargs):
        captured["cmd"] = cmd
        return FakePopen(returncode=0, stdout=json.dumps({"result": "x"}), stderr="")

    monkeypatch.setattr(claude_cli.subprocess, "Popen", fake_popen)

    claude_cli.run_prompt("p", system="EXTRA_SYS", skill=skills.AUTOMATION_GENERATOR)
    injected = captured["cmd"][captured["cmd"].index("--append-system-prompt") + 1]
    assert "Automation Generator" in injected and "EXTRA_SYS" in injected
