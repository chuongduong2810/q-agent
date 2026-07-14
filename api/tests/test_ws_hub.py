"""Tests for ``app.ws.ProgressHub`` last-event replay (#293).

A client that connects mid-run (or after a reload) must be caught up with the
run's most recent progress event immediately, instead of waiting for the next
one — otherwise the run detail looks frozen when early phase events were
published before the socket finished connecting.
"""

from __future__ import annotations

import asyncio
from typing import Any

from app.ws import ProgressHub


class _FakeWS:
    """Minimal stand-in for a Starlette WebSocket (accept + send_json)."""

    def __init__(self) -> None:
        self.accepted = False
        self.sent: list[dict[str, Any]] = []

    async def accept(self) -> None:
        self.accepted = True

    async def send_json(self, message: dict[str, Any]) -> None:
        self.sent.append(message)


async def test_connect_replays_last_event_to_a_late_joiner():
    """An event published before any client connected is replayed on connect."""
    hub = ProgressHub()
    hub.bind_loop(asyncio.get_running_loop())

    # Early phase event fires before the client's socket connects.
    hub.publish("7", "analysis.phase", {"ticket": "500", "message": "Generating test cases..."})

    ws = _FakeWS()
    await hub.connect("7", ws)

    assert ws.accepted
    assert len(ws.sent) == 1
    assert ws.sent[-1]["event"] == "analysis.phase"
    assert ws.sent[-1]["payload"]["message"] == "Generating test cases..."


async def test_connect_without_prior_event_sends_nothing():
    """No cached event → connect accepts but replays nothing (clean first join)."""
    hub = ProgressHub()
    hub.bind_loop(asyncio.get_running_loop())

    ws = _FakeWS()
    await hub.connect("9", ws)

    assert ws.accepted
    assert ws.sent == []


async def test_last_event_is_per_run():
    """Replay is scoped to the run: run 7's client never sees run 8's event."""
    hub = ProgressHub()
    hub.bind_loop(asyncio.get_running_loop())

    hub.publish("7", "analysis.phase", {"message": "seven"})
    hub.publish("8", "analysis.phase", {"message": "eight"})

    ws = _FakeWS()
    await hub.connect("7", ws)

    assert [m["payload"]["message"] for m in ws.sent] == ["seven"]
