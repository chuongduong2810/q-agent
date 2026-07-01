"""Jira provider adapter.

Talks to the real Jira Cloud REST API (v3) via ``httpx`` (ADR 0001 — no mock
fallback). Authenticates with HTTP basic auth using the account email + an API
token.

Config fields (non-secret): ``baseUrl`` (e.g. "https://myorg.atlassian.net"),
``project`` (default project key).
Secret fields: ``email``, ``apiToken``.
"""

from __future__ import annotations

from typing import Any

import httpx

from app.services.adapters import register
from app.services.adapters.base import NormalizedTicket, ProviderAdapter, ProviderError

API_PREFIX = "/rest/api/3"

# Best-effort custom field id for acceptance criteria (varies by Jira instance).
ACCEPTANCE_CRITERIA_FIELD = "customfield_10020"


def _adf_to_text(node: Any) -> str:
    """Best-effort Atlassian Document Format (ADF) -> plain text."""
    if node is None:
        return ""
    if isinstance(node, str):
        return node
    if not isinstance(node, dict):
        return ""

    node_type = node.get("type")
    if node_type == "text":
        return node.get("text", "")

    parts = [_adf_to_text(child) for child in node.get("content", [])]
    text = "".join(parts) if node_type in ("paragraph", "heading") else "\n".join(p for p in parts if p)

    if node_type == "paragraph":
        return text + "\n"
    if node_type == "listItem":
        return "- " + text
    return text


def _split_ac(text: str) -> list[str]:
    if not text:
        return []
    lines = [ln.strip("-• \t") for ln in text.splitlines()]
    return [ln for ln in lines if ln]


class JiraAdapter(ProviderAdapter):
    kind = "jira"

    def __init__(self, config: dict, secrets: dict) -> None:
        super().__init__(config, secrets)
        self.base_url = (self.config.get("baseUrl") or self.config.get("base_url") or "").rstrip("/")
        self.project = self.config.get("project") or ""
        self.email = self.secrets.get("email") or ""
        self.api_token = self.secrets.get("apiToken") or self.secrets.get("api_token") or ""

    def _client(self) -> httpx.Client:
        if not self.base_url:
            raise ProviderError("Jira baseUrl is not configured")
        if not self.email or not self.api_token:
            raise ProviderError("Jira email/apiToken are not configured")
        return httpx.Client(
            base_url=self.base_url,
            auth=(self.email, self.api_token),
            headers={"Accept": "application/json", "Content-Type": "application/json"},
            timeout=30.0,
        )

    # -- Connectivity -----------------------------------------------------
    def test_connection(self) -> dict[str, Any]:
        try:
            with self._client() as client:
                resp = client.get(f"{API_PREFIX}/myself")
                resp.raise_for_status()
                data = resp.json()
                return {
                    "ok": True,
                    "message": f"Connected to Jira as {data.get('displayName', self.email)}",
                    "detail": {"accountId": data.get("accountId", "")},
                }
        except ProviderError as exc:
            return {"ok": False, "message": str(exc), "detail": {}}
        except httpx.HTTPStatusError as exc:
            return {
                "ok": False,
                "message": f"Jira returned {exc.response.status_code}",
                "detail": {"status_code": exc.response.status_code},
            }
        except httpx.HTTPError as exc:
            return {"ok": False, "message": f"Jira connection failed: {exc}", "detail": {}}

    # -- Read ---------------------------------------------------------------
    def list_projects(self) -> list[dict[str, Any]]:
        with self._client() as client:
            resp = client.get(f"{API_PREFIX}/project/search")
            resp.raise_for_status()
            data = resp.json()
            return [
                {"external_id": p["key"], "name": p.get("name", p["key"])}
                for p in data.get("values", [])
            ]

    def fetch_tickets(
        self,
        *,
        mode: str = "sprint",
        sprint: str | None = None,
        ticket_ids: list[str] | None = None,
    ) -> list[NormalizedTicket]:
        jql = self._build_jql(mode=mode, sprint=sprint, ticket_ids=ticket_ids)
        with self._client() as client:
            resp = client.post(
                f"{API_PREFIX}/search/jql",
                json={
                    "jql": jql,
                    "maxResults": 200,
                    "fields": [
                        "summary",
                        "status",
                        "priority",
                        "assignee",
                        "sprint",
                        "description",
                        "labels",
                        "comment",
                        "attachment",
                        "issuetype",
                        ACCEPTANCE_CRITERIA_FIELD,
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return [self._normalize(issue) for issue in data.get("issues", [])]

    def _build_jql(self, *, mode: str, sprint: str | None, ticket_ids: list[str] | None) -> str:
        if mode == "selected" and ticket_ids:
            keys = ",".join(ticket_ids)
            return f"key in ({keys})"

        conditions = []
        if self.project:
            conditions.append(f"project = {self.project}")
        if mode == "sprint" and sprint:
            conditions.append(f"sprint = '{sprint}'")
        elif mode == "assigned":
            conditions.append("assignee = currentUser()")

        return " AND ".join(conditions) if conditions else "order by created DESC"

    def _normalize(self, issue: dict[str, Any]) -> NormalizedTicket:
        fields = issue.get("fields", {})
        assignee = (fields.get("assignee") or {}).get("displayName", "") if fields.get("assignee") else ""
        priority = (fields.get("priority") or {}).get("name", "Medium")
        status = (fields.get("status") or {}).get("name", "")
        issue_type = (fields.get("issuetype") or {}).get("name", "User Story")

        description = _adf_to_text(fields.get("description")).strip()

        ac_field = fields.get(ACCEPTANCE_CRITERIA_FIELD)
        if isinstance(ac_field, dict):
            ac_text = _adf_to_text(ac_field)
        elif isinstance(ac_field, str):
            ac_text = ac_field
        else:
            ac_text = ""
        acceptance_criteria = _split_ac(ac_text)

        comments = []
        for c in (fields.get("comment") or {}).get("comments", []):
            comments.append(
                {
                    "who": (c.get("author") or {}).get("displayName", ""),
                    "when": c.get("created", ""),
                    "text": _adf_to_text(c.get("body")).strip(),
                }
            )

        attachments = [
            {"name": a.get("filename", ""), "size": str(a.get("size", ""))}
            for a in fields.get("attachment", [])
        ]

        sprint_field = fields.get("sprint")
        if isinstance(sprint_field, list) and sprint_field:
            sprint_name = sprint_field[-1].get("name", "")
        elif isinstance(sprint_field, dict):
            sprint_name = sprint_field.get("name", "")
        else:
            sprint_name = ""

        return NormalizedTicket(
            external_id=issue.get("key", ""),
            provider_kind=self.kind,
            title=fields.get("summary", ""),
            work_item_type=issue_type,
            status=status,
            priority=self._map_priority(priority),
            assignee=assignee,
            sprint=sprint_name,
            description=description,
            note="",
            labels=fields.get("labels", []) or [],
            acceptance_criteria=acceptance_criteria,
            comments=comments,
            attachments=attachments,
            linked_prs=[],
        )

    @staticmethod
    def _map_priority(name: str) -> str:
        n = (name or "").lower()
        if n in ("highest", "high"):
            return "High"
        if n in ("lowest", "low"):
            return "Low"
        return "Medium"

    # -- Write ------------------------------------------------------------
    def publish_comment(
        self,
        ticket_external_id: str,
        body: str,
        *,
        attachments: list[str] | None = None,
    ) -> str:
        with self._client() as client:
            resp = client.post(
                f"{API_PREFIX}/issue/{ticket_external_id}/comment",
                json={
                    "body": {
                        "type": "doc",
                        "version": 1,
                        "content": [
                            {"type": "paragraph", "content": [{"type": "text", "text": body}]}
                        ],
                    }
                },
            )
            resp.raise_for_status()
            return str(resp.json().get("id", ""))

    def update_status(self, ticket_external_id: str, target_status: str) -> None:
        with self._client() as client:
            resp = client.get(f"{API_PREFIX}/issue/{ticket_external_id}/transitions")
            resp.raise_for_status()
            transitions = resp.json().get("transitions", [])
            match = next(
                (t for t in transitions if t.get("name", "").lower() == target_status.lower()),
                None,
            )
            if not match:
                raise ProviderError(f"No Jira transition named '{target_status}' available")
            resp = client.post(
                f"{API_PREFIX}/issue/{ticket_external_id}/transitions",
                json={"transition": {"id": match["id"]}},
            )
            resp.raise_for_status()


register("jira", JiraAdapter)
