"""Ambient "current run" context for attributing background AI spend to a run.

Claude CLI usage is logged deep inside :mod:`app.services.claude_cli`, far from
the run-scoped worker that triggered it. Rather than thread a ``run_id`` through
every call, run-scoped thread workers set it here once (at the top of the worker)
and :func:`app.services.ai_usage_service.record` reads it back when it persists a
usage row.

Because a freshly-started :class:`threading.Thread` gets its own empty context,
the variable is naturally isolated per worker thread — but it MUST be set *inside*
each worker (not before starting the thread) for that isolation to apply.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Iterator

_current_run: ContextVar[int | None] = ContextVar("current_run_id", default=None)
# The ambient ticket within the current run — set per-ticket by the pipeline so
# AI spend can be attributed to a ticket (grouped-by-ticket cost card), the same
# way _current_run attributes it to a run. None for run-level (non-ticket) calls.
_current_ticket: ContextVar[str | None] = ContextVar("current_ticket_external_id", default=None)
# The ambient owner (user id) for background work that has NO run to derive an
# owner from — e.g. a project-knowledge build thread. When set, it takes priority
# over the run→owner lookup in claude_credentials.resolve_ambient_owner_id, so the
# Claude call resolves that user's own (or their preferred) credentials rather than
# falling back to the shared one. None when unset.
_current_owner: ContextVar[int | None] = ContextVar("current_owner_id", default=None)


def set_run(run_id: int | None) -> None:
    """Set the ambient run id for the current context (thread/task)."""
    _current_run.set(run_id)


def get_run() -> int | None:
    """Return the ambient run id for the current context, or None if unset."""
    return _current_run.get()


def get_ticket() -> str | None:
    """Return the ambient ticket external id for the current context, or None."""
    return _current_ticket.get()


def get_owner() -> int | None:
    """Return the ambient owner id for the current context, or None if unset."""
    return _current_owner.get()


def clear() -> None:
    """Clear the ambient run id + ticket + owner for the current context."""
    _current_run.set(None)
    _current_ticket.set(None)
    _current_owner.set(None)


@contextmanager
def ticket_scope(ticket_external_id: str | None) -> Iterator[None]:
    """Bind ``ticket_external_id`` as the ambient ticket for the ``with`` block.

    Restores the previous value on exit (nested/reentrant use is safe). Used by
    the analyze+generate pipeline to attribute each ticket's Claude spend.
    """
    token = _current_ticket.set(ticket_external_id)
    try:
        yield
    finally:
        _current_ticket.reset(token)


@contextmanager
def run_scope(run_id: int | None) -> Iterator[None]:
    """Bind ``run_id`` as the ambient run for the duration of the ``with`` block.

    Restores the previous value on exit (so nested/reentrant use is safe).
    """
    token = _current_run.set(run_id)
    try:
        yield
    finally:
        _current_run.reset(token)


@contextmanager
def owner_scope(owner_id: int | None) -> Iterator[None]:
    """Bind ``owner_id`` as the ambient owner for the duration of the ``with`` block.

    For background work that has no run to derive an owner from (e.g. a knowledge
    build), so the Claude call resolves that user's own/preferred credentials
    instead of falling back to the shared one. Restores the previous value on exit
    (nested/reentrant use is safe).
    """
    token = _current_owner.set(owner_id)
    try:
        yield
    finally:
        _current_owner.reset(token)
