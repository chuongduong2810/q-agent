"""Unit tests for the in-process cancel/kill registry (run_control).

Focus on the durable-cancel guarantee: a subprocess registered *after* cancel
was requested must be killed immediately, not tracked — otherwise AI/Playwright
processes spawned in the window right after the one-shot ``kill_processes`` (the
generate-cases Claude call, later self-heal attempts) would escape the cancel.
"""

from __future__ import annotations

from app.services import run_control


class FakeProc:
    """Records whether kill()/terminate() was called."""

    def __init__(self) -> None:
        self.killed = False
        self.terminated = False

    def kill(self) -> None:
        self.killed = True

    def terminate(self) -> None:
        self.terminated = True


def test_kill_processes_terminates_tracked(run_id: int = 90001) -> None:
    run_control.clear(run_id)
    proc = FakeProc()
    run_control.register_process(run_id, proc)
    run_control.kill_processes(run_id)
    assert proc.killed is True
    run_control.clear(run_id)


def test_register_after_cancel_kills_immediately(run_id: int = 90002) -> None:
    run_control.clear(run_id)
    # Simulate the cancel endpoint: request_cancel then the one-shot kill.
    run_control.request_cancel(run_id)
    run_control.kill_processes(run_id)

    # A process spawned *after* the one-shot kill (e.g. the generate-cases
    # Claude call, or a later self-heal attempt) must be killed on registration.
    late = FakeProc()
    run_control.register_process(run_id, late)
    assert late.killed is True
    # ...and not left tracked.
    run_control.kill_processes(run_id)
    run_control.clear(run_id)


def test_register_without_cancel_tracks_and_survives(run_id: int = 90003) -> None:
    run_control.clear(run_id)
    proc = FakeProc()
    run_control.register_process(run_id, proc)
    assert proc.killed is False
    assert proc.terminated is False
    # Finishing on its own unregisters cleanly; a later kill is a no-op for it.
    run_control.unregister_process(run_id, proc)
    run_control.kill_processes(run_id)
    assert proc.killed is False
    run_control.clear(run_id)
