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
AGILE_PREFIX = "/rest/agile/1.0"

# Best-effort custom field id for acceptance criteria (varies by Jira instance).
ACCEPTANCE_CRITERIA_FIELD = "customfield_10020"
# Best-effort custom field id for the classic (company-managed) "Epic Link" field
# (varies by Jira instance; team-managed projects use the `parent` field instead).
EPIC_LINK_FIELD = "customfield_10014"


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


def _text_to_adf(text: str) -> dict:
    """Wrap plain text into a minimal Atlassian Document Format doc."""
    lines = text.split("\n") if text else [""]
    return {
        "type": "doc",
        "version": 1,
        "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": ln or " "}]} for ln in lines
        ],
    }


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

    def list_sprints(self) -> list[dict[str, Any]]:
        """List active + future sprints across the project's agile boards.

        Returns [{id, name, path, state}] where ``path`` is the numeric sprint id
        (JQL ``sprint = <id>`` is the most reliable form). Best-effort: a project
        without agile boards yields an empty list rather than an error.
        """
        if not self.project:
            return []
        sprints: dict[str, dict[str, Any]] = {}
        try:
            with self._client() as client:
                boards = client.get(
                    f"{AGILE_PREFIX}/board", params={"projectKeyOrId": self.project}
                )
                boards.raise_for_status()
                for board in boards.json().get("values", []):
                    resp = client.get(
                        f"{AGILE_PREFIX}/board/{board['id']}/sprint",
                        params={"state": "active,future"},
                    )
                    if resp.status_code != 200:
                        continue
                    for sp in resp.json().get("values", []):
                        sid = str(sp.get("id"))
                        sprints[sid] = {
                            "id": sid,
                            "name": sp.get("name", sid),
                            "path": sid,
                            "start_date": sp.get("startDate"),
                            "finish_date": sp.get("endDate"),
                            "state": sp.get("state"),
                        }
        except httpx.HTTPError:
            return list(sprints.values())
        return list(sprints.values())

    def list_work_item_metadata(self) -> dict[str, Any]:
        """Jira has no area paths; return issue types + statuses + epics (best-effort)."""
        types: list[str] = []
        states: list[str] = []
        epics: list[dict[str, str]] = []
        try:
            with self._client() as client:
                it = client.get(f"{API_PREFIX}/issuetype")
                if it.status_code < 400:
                    types = sorted({t.get("name", "") for t in it.json() if t.get("name")})
                st = client.get(f"{API_PREFIX}/status")
                if st.status_code < 400:
                    states = sorted({s.get("name", "") for s in st.json() if s.get("name")})
                jql = f"project = {self.project} AND issuetype = Epic" if self.project else "issuetype = Epic"
                ep = client.post(
                    f"{API_PREFIX}/search/jql",
                    json={"jql": jql, "maxResults": 100, "fields": ["summary"]},
                )
                if ep.status_code < 400:
                    epics = [
                        {"key": issue.get("key", ""), "name": issue.get("fields", {}).get("summary", "")}
                        for issue in ep.json().get("issues", [])
                    ]
        except httpx.HTTPError:
            pass
        return {"area_paths": [], "work_item_types": types, "states": states, "epics": epics}

    def fetch_tickets(
        self,
        *,
        mode: str = "sprint",
        sprint: str | None = None,
        sprint_path: str | None = None,
        area_path: str | None = None,  # ADO-only; unused for Jira
        states: list[str] | None = None,
        work_item_types: list[str] | None = None,
        ticket_ids: list[str] | None = None,
        include_comments: bool = False,  # Jira returns comments inline; flag unused
        project: str | None = None,
    ) -> list[NormalizedTicket]:
        jql = self._build_jql(
            mode=mode,
            sprint=sprint,
            sprint_path=sprint_path,
            states=states,
            work_item_types=work_item_types,
            ticket_ids=ticket_ids,
            project=project,
        )
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
                        "parent",
                        ACCEPTANCE_CRITERIA_FIELD,
                        EPIC_LINK_FIELD,
                    ],
                },
            )
            resp.raise_for_status()
            data = resp.json()
            return [self._normalize(issue) for issue in data.get("issues", [])]

    def _build_jql(
        self,
        *,
        mode: str,
        sprint: str | None,
        sprint_path: str | None = None,
        states: list[str] | None = None,
        work_item_types: list[str] | None = None,
        ticket_ids: list[str] | None = None,
        project: str | None = None,
    ) -> str:
        if mode == "selected" and ticket_ids:
            keys = ",".join(ticket_ids)
            return f"key in ({keys})"

        conditions = []
        proj = project or self.project
        if proj:
            conditions.append(f"project = {proj}")
        if mode == "sprint" and (sprint_path or sprint):
            # sprint_path is the numeric sprint id (preferred); else match by name.
            if sprint_path and str(sprint_path).isdigit():
                conditions.append(f"sprint = {sprint_path}")
            else:
                conditions.append(f"sprint = '{(sprint or sprint_path)}'")
        elif mode == "assigned":
            conditions.append("assignee = currentUser()")
        if states:
            conditions.append("status IN (" + ", ".join(f'"{s}"' for s in states) + ")")
        if work_item_types:
            conditions.append("issuetype IN (" + ", ".join(f'"{t}"' for t in work_item_types) + ")")

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

        epic = ""
        parent = fields.get("parent")
        if isinstance(parent, dict):
            epic = (parent.get("fields") or {}).get("summary", "") or ""
        if not epic:
            epic_link = fields.get(EPIC_LINK_FIELD)
            if isinstance(epic_link, str):
                epic = epic_link

        return NormalizedTicket(
            external_id=issue.get("key", ""),
            provider_kind=self.kind,
            title=fields.get("summary", ""),
            work_item_type=issue_type,
            status=status,
            priority=self._map_priority(priority),
            assignee=assignee,
            sprint=sprint_name,
            epic=epic,
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

    def create_test_case(
        self,
        ticket_external_id: str,
        *,
        title: str,
        precondition: str = "",
        steps: list[dict[str, Any]] | None = None,
        priority: str = "Medium",
        link: bool = True,
    ) -> dict[str, Any]:
        """Create a Jira issue for the test case and link it to the ticket ('Relates')."""
        if not self.project:
            raise ProviderError("Jira project is not configured")
        body_lines = []
        if precondition:
            body_lines.append(f"Precondition: {precondition}")
        for i, st in enumerate(steps or [], start=1):
            body_lines.append(f"{i}. {st.get('a', '')} -> {st.get('e', '')}")
        description = _text_to_adf("\n".join(body_lines) or title)

        with self._client() as client:
            def _create(issuetype: str) -> httpx.Response:
                return client.post(
                    f"{API_PREFIX}/issue",
                    json={
                        "fields": {
                            "project": {"key": self.project},
                            "summary": title[:250],
                            "description": description,
                            "issuetype": {"name": issuetype},
                        }
                    },
                )

            resp = _create("Test")
            if resp.status_code >= 400:
                resp = _create("Task")  # not all instances have a 'Test' issue type
            if resp.status_code >= 400:
                raise ProviderError(f"Jira create issue failed ({resp.status_code}): {resp.text[:300]}")
            key = resp.json().get("key", "")

            linked = False
            if link and key:
                lr = client.post(
                    f"{API_PREFIX}/issueLink",
                    json={
                        "type": {"name": "Relates"},
                        "inwardIssue": {"key": key},
                        "outwardIssue": {"key": ticket_external_id},
                    },
                )
                linked = lr.status_code < 400
        return {
            "external_id": key,
            "url": f"{self.base_url}/browse/{key}" if key else "",
            "status": "To Do",
            "linked": linked,
        }

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
