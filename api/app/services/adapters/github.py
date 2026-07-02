"""GitHub provider adapter.

Talks to the real GitHub REST API via ``httpx`` (ADR 0001 — no mock fallback).
Authenticates with a personal access token (bearer). Issues are treated as
tickets.

Config fields (non-secret): ``org`` (owner/org login), ``repo`` (repository name).
Secret fields: ``pat`` (Personal Access Token).
"""

from __future__ import annotations

from typing import Any

import httpx

from app.services.adapters import register
from app.services.adapters.base import NormalizedTicket, ProviderAdapter, ProviderError

API_BASE = "https://api.github.com"


class GitHubAdapter(ProviderAdapter):
    kind = "github"

    def __init__(self, config: dict, secrets: dict) -> None:
        super().__init__(config, secrets)
        self.org = self.config.get("org") or ""
        self.repo = self.config.get("repo") or ""
        self.pat = self.secrets.get("pat") or ""

    def _client(self) -> httpx.Client:
        if not self.pat:
            raise ProviderError("GitHub PAT is not configured")
        return httpx.Client(
            base_url=API_BASE,
            headers={
                "Authorization": f"Bearer {self.pat}",
                "Accept": "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28",
            },
            timeout=30.0,
        )

    # -- Connectivity -----------------------------------------------------
    def test_connection(self) -> dict[str, Any]:
        try:
            with self._client() as client:
                resp = client.get("/user")
                resp.raise_for_status()
                data = resp.json()
                return {
                    "ok": True,
                    "message": f"Connected to GitHub as {data.get('login', '')}",
                    "detail": {"login": data.get("login", "")},
                }
        except ProviderError as exc:
            return {"ok": False, "message": str(exc), "detail": {}}
        except httpx.HTTPStatusError as exc:
            return {
                "ok": False,
                "message": f"GitHub returned {exc.response.status_code}",
                "detail": {"status_code": exc.response.status_code},
            }
        except httpx.HTTPError as exc:
            return {"ok": False, "message": f"GitHub connection failed: {exc}", "detail": {}}

    # -- Read ---------------------------------------------------------------
    def list_projects(self) -> list[dict[str, Any]]:
        """GitHub has no "project" concept matching ADO/Jira; return the configured repo."""
        if not self.org or not self.repo:
            return []
        with self._client() as client:
            resp = client.get(f"/repos/{self.org}/{self.repo}")
            resp.raise_for_status()
            data = resp.json()
            return [{"external_id": str(data["id"]), "name": data.get("full_name", self.repo)}]

    def fetch_tickets(
        self,
        *,
        mode: str = "sprint",
        sprint: str | None = None,
        sprint_path: str | None = None,
        area_path: str | None = None,
        states: list[str] | None = None,
        work_item_types: list[str] | None = None,
        ticket_ids: list[str] | None = None,
        include_comments: bool = False,
    ) -> list[NormalizedTicket]:
        if not self.org or not self.repo:
            raise ProviderError("GitHub org/repo is not configured")

        with self._client() as client:
            if mode == "selected" and ticket_ids:
                issues = [self._get_issue(client, num) for num in ticket_ids]
                issues = [i for i in issues if i]
            else:
                params: dict[str, Any] = {"state": "open", "per_page": 100}
                if mode == "assigned":
                    params["assignee"] = self._current_login(client)
                resp = client.get(f"/repos/{self.org}/{self.repo}/issues", params=params)
                resp.raise_for_status()
                issues = [i for i in resp.json() if "pull_request" not in i]

            return [
                self._normalize(client, issue, include_comments=include_comments) for issue in issues
            ]

    def fetch_comments(self, ticket_external_id: str) -> list[dict[str, Any]]:
        with self._client() as client:
            resp = client.get(
                f"/repos/{self.org}/{self.repo}/issues/{ticket_external_id}/comments"
            )
            if resp.status_code != 200:
                return []
            return [
                {
                    "who": (c.get("user") or {}).get("login", ""),
                    "when": c.get("created_at", ""),
                    "text": c.get("body", "") or "",
                }
                for c in resp.json()
            ]

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
        """Create a GitHub issue for the test case, referencing the source issue."""
        if not self.org or not self.repo:
            raise ProviderError("GitHub org/repo is not configured")
        lines = [f"**Priority:** {priority}"]
        if precondition:
            lines.append(f"**Precondition:** {precondition}")
        for i, st in enumerate(steps or [], start=1):
            lines.append(f"{i}. {st.get('a', '')} — _{st.get('e', '')}_")
        if link:
            lines.append(f"\nTest case for #{ticket_external_id}")
        with self._client() as client:
            resp = client.post(
                f"/repos/{self.org}/{self.repo}/issues",
                json={"title": f"[Test] {title}", "body": "\n".join(lines), "labels": ["qa", "test-case"]},
            )
            if resp.status_code >= 400:
                raise ProviderError(f"GitHub create issue failed ({resp.status_code}): {resp.text[:300]}")
            issue = resp.json()
        return {
            "external_id": str(issue.get("number", "")),
            "url": issue.get("html_url", ""),
            "status": "Open",
            "linked": bool(link),
        }

    def _current_login(self, client: httpx.Client) -> str:
        resp = client.get("/user")
        resp.raise_for_status()
        return resp.json().get("login", "")

    def _get_issue(self, client: httpx.Client, number: str) -> dict[str, Any] | None:
        resp = client.get(f"/repos/{self.org}/{self.repo}/issues/{number}")
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        return resp.json()

    def _normalize(
        self, client: httpx.Client, issue: dict[str, Any], *, include_comments: bool = False
    ) -> NormalizedTicket:
        number = issue.get("number")
        labels = [lbl.get("name", "") if isinstance(lbl, dict) else lbl for lbl in issue.get("labels", [])]
        assignee = (issue.get("assignee") or {}).get("login", "") if issue.get("assignee") else ""

        comments = []
        if include_comments and issue.get("comments", 0):
            resp = client.get(f"/repos/{self.org}/{self.repo}/issues/{number}/comments")
            if resp.status_code == 200:
                for c in resp.json():
                    comments.append(
                        {
                            "who": (c.get("user") or {}).get("login", ""),
                            "when": c.get("created_at", ""),
                            "text": c.get("body", "") or "",
                        }
                    )

        return NormalizedTicket(
            external_id=str(number),
            provider_kind=self.kind,
            title=issue.get("title", ""),
            work_item_type="Issue",
            status="Done" if issue.get("state") == "closed" else "In Progress",
            priority=self._map_priority(labels),
            assignee=assignee,
            sprint="",
            description=issue.get("body", "") or "",
            note="",
            labels=labels,
            acceptance_criteria=[],
            comments=comments,
            attachments=[],
            linked_prs=[],
        )

    @staticmethod
    def _map_priority(labels: list[str]) -> str:
        lowered = [lbl.lower() for lbl in labels]
        if any("high" in lbl or "critical" in lbl or "urgent" in lbl for lbl in lowered):
            return "High"
        if any("low" in lbl for lbl in lowered):
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
                f"/repos/{self.org}/{self.repo}/issues/{ticket_external_id}/comments",
                json={"body": body},
            )
            resp.raise_for_status()
            return str(resp.json().get("id", ""))

    def update_status(self, ticket_external_id: str, target_status: str) -> None:
        state = "closed" if target_status.lower() in ("done", "closed") else "open"
        with self._client() as client:
            resp = client.patch(
                f"/repos/{self.org}/{self.repo}/issues/{ticket_external_id}",
                json={"state": state},
            )
            resp.raise_for_status()


register("github", GitHubAdapter)
