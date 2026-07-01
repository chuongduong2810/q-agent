"""Abstract provider adapter interface.

Every provider (ADO / Jira / GitHub) implements this contract so the sync and
publish layers stay provider-agnostic. Adapters talk to the **real** REST APIs
via httpx; there is no mock path (ADR 0001).
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any


class ProviderError(RuntimeError):
    """Raised on adapter configuration or upstream API failures."""


class NormalizedTicket(dict):
    """A provider-agnostic ticket dict.

    Expected keys (all optional except external_id/title):
      external_id, provider_kind, title, work_item_type, status, priority,
      assignee, sprint, description, note, labels(list[str]),
      acceptance_criteria(list[str]), comments(list[dict]),
      attachments(list[dict]), linked_prs(list[dict]).
    """


class ProviderAdapter(ABC):
    """Base class for provider integrations."""

    kind: str = ""

    def __init__(self, config: dict, secrets: dict) -> None:
        self.config = config or {}
        self.secrets = secrets or {}

    # -- Connectivity -----------------------------------------------------
    @abstractmethod
    def test_connection(self) -> dict[str, Any]:
        """Verify credentials/reachability. Returns {ok, message, detail}."""

    # -- Read -------------------------------------------------------------
    @abstractmethod
    def list_projects(self) -> list[dict[str, Any]]:
        """Return [{external_id, name, ...}] for connectable projects."""

    @abstractmethod
    def fetch_tickets(
        self,
        *,
        mode: str = "sprint",
        sprint: str | None = None,
        ticket_ids: list[str] | None = None,
    ) -> list[NormalizedTicket]:
        """Fetch and normalize tickets for the given selection mode."""

    # -- Write ------------------------------------------------------------
    @abstractmethod
    def publish_comment(
        self,
        ticket_external_id: str,
        body: str,
        *,
        attachments: list[str] | None = None,
    ) -> str:
        """Post a comment to the work item. Returns the external comment id."""

    def update_status(self, ticket_external_id: str, target_status: str) -> None:
        """Transition the work item's status (optional; override if supported)."""
        return None
