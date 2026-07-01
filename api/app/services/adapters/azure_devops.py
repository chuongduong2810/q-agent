"""Azure DevOps provider adapter.

Talks to the real Azure DevOps REST API via ``httpx`` (ADR 0001 — no mock
fallback). Authenticates with basic auth using an empty username and a PAT
(Azure DevOps convention).

Config fields (non-secret): ``orgUrl`` (e.g. "https://dev.azure.com/myorg"),
``project`` (default ADO project name).
Secret fields: ``pat`` (Personal Access Token).
"""

from __future__ import annotations

import base64
import re
from typing import Any

import httpx

from app.services.adapters import register
from app.services.adapters.base import NormalizedTicket, ProviderAdapter, ProviderError

API_VERSION = "7.1"


def _strip_html(html: str) -> str:
    """Best-effort HTML -> plain text for ADO rich-text fields."""
    if not html:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", html, flags=re.IGNORECASE)
    text = re.sub(r"</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<li[^>]*>", "- ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")
    return text.strip()


def _split_ac(text: str) -> list[str]:
    """Split acceptance-criteria text into a list of criteria lines."""
    if not text:
        return []
    lines = [ln.strip("-• \t") for ln in text.splitlines()]
    return [ln for ln in lines if ln]


class AzureDevOpsAdapter(ProviderAdapter):
    kind = "ado"

    def __init__(self, config: dict, secrets: dict) -> None:
        super().__init__(config, secrets)
        self.org_url = (self.config.get("orgUrl") or self.config.get("org_url") or "").rstrip("/")
        self.project = self.config.get("project") or ""
        self.pat = self.secrets.get("pat") or ""

    def _client(self) -> httpx.Client:
        if not self.org_url:
            raise ProviderError("Azure DevOps orgUrl is not configured")
        if not self.pat:
            raise ProviderError("Azure DevOps PAT is not configured")
        token = base64.b64encode(f":{self.pat}".encode("utf-8")).decode("utf-8")
        return httpx.Client(
            base_url=self.org_url,
            headers={"Authorization": f"Basic {token}", "Content-Type": "application/json"},
            timeout=30.0,
        )

    # -- Connectivity -----------------------------------------------------
    def test_connection(self) -> dict[str, Any]:
        try:
            with self._client() as client:
                resp = client.get(f"/_apis/projects?api-version={API_VERSION}")
                resp.raise_for_status()
                data = resp.json()
                return {
                    "ok": True,
                    "message": f"Connected to Azure DevOps ({data.get('count', 0)} projects visible)",
                    "detail": {"count": data.get("count", 0)},
                }
        except ProviderError as exc:
            return {"ok": False, "message": str(exc), "detail": {}}
        except httpx.HTTPStatusError as exc:
            return {
                "ok": False,
                "message": f"Azure DevOps returned {exc.response.status_code}",
                "detail": {"status_code": exc.response.status_code},
            }
        except httpx.HTTPError as exc:
            return {"ok": False, "message": f"Azure DevOps connection failed: {exc}", "detail": {}}

    # -- Read ---------------------------------------------------------------
    def list_projects(self) -> list[dict[str, Any]]:
        with self._client() as client:
            resp = client.get(f"/_apis/projects?api-version={API_VERSION}")
            resp.raise_for_status()
            data = resp.json()
            return [
                {"external_id": p["id"], "name": p["name"], "state": p.get("state", "")}
                for p in data.get("value", [])
            ]

    def fetch_tickets(
        self,
        *,
        mode: str = "sprint",
        sprint: str | None = None,
        ticket_ids: list[str] | None = None,
    ) -> list[NormalizedTicket]:
        project = self.project
        if not project:
            raise ProviderError("Azure DevOps project is not configured")

        with self._client() as client:
            ids = self._query_work_item_ids(client, project, mode=mode, sprint=sprint, ticket_ids=ticket_ids)
            if not ids:
                return []
            items = self._get_work_items(client, ids)
            return [self._normalize(client, item) for item in items]

    def _query_work_item_ids(
        self,
        client: httpx.Client,
        project: str,
        *,
        mode: str,
        sprint: str | None,
        ticket_ids: list[str] | None,
    ) -> list[int]:
        if mode == "selected" and ticket_ids:
            return [int(tid) for tid in ticket_ids if str(tid).isdigit()]

        conditions = [f"[System.TeamProject] = '{project}'"]
        if mode == "sprint" and sprint:
            conditions.append(f"[System.IterationPath] UNDER '{project}\\{sprint}'")
        elif mode == "assigned":
            conditions.append("[System.AssignedTo] = @Me")

        wiql = {
            "query": (
                "SELECT [System.Id] FROM WorkItems WHERE "
                + " AND ".join(conditions)
                + " ORDER BY [System.ChangedDate] DESC"
            )
        }
        resp = client.post(
            f"/{project}/_apis/wit/wiql?api-version={API_VERSION}",
            json=wiql,
        )
        resp.raise_for_status()
        data = resp.json()
        return [wi["id"] for wi in data.get("workItems", [])]

    def _get_work_items(self, client: httpx.Client, ids: list[int]) -> list[dict[str, Any]]:
        items: list[dict[str, Any]] = []
        for i in range(0, len(ids), 200):
            batch = ids[i : i + 200]
            id_str = ",".join(str(i) for i in batch)
            resp = client.get(
                "/_apis/wit/workitems",
                params={
                    "ids": id_str,
                    "$expand": "relations",
                    "api-version": API_VERSION,
                },
            )
            resp.raise_for_status()
            items.extend(resp.json().get("value", []))
        return items

    def _normalize(self, client: httpx.Client, item: dict[str, Any]) -> NormalizedTicket:
        fields = item.get("fields", {})
        wi_id = item["id"]

        labels = [t.strip() for t in (fields.get("System.Tags") or "").split(";") if t.strip()]
        ac_html = fields.get("Microsoft.VSTS.Common.AcceptanceCriteria", "")
        comments = self._fetch_comments(client, wi_id)
        attachments, linked_prs = self._parse_relations(item.get("relations", []))

        assigned_to = fields.get("System.AssignedTo") or {}
        if isinstance(assigned_to, dict):
            assignee = assigned_to.get("displayName", "")
        else:
            assignee = str(assigned_to)

        return NormalizedTicket(
            external_id=str(wi_id),
            provider_kind=self.kind,
            title=fields.get("System.Title", ""),
            work_item_type=fields.get("System.WorkItemType", "User Story"),
            status=fields.get("System.State", ""),
            priority=self._map_priority(fields.get("Microsoft.VSTS.Common.Priority")),
            assignee=assignee,
            sprint=(fields.get("System.IterationPath") or "").split("\\")[-1],
            description=_strip_html(fields.get("System.Description", "")),
            note="",
            labels=labels,
            acceptance_criteria=_split_ac(_strip_html(ac_html)),
            comments=comments,
            attachments=attachments,
            linked_prs=linked_prs,
        )

    @staticmethod
    def _map_priority(value: Any) -> str:
        try:
            n = int(value)
        except (TypeError, ValueError):
            return "Medium"
        if n <= 1:
            return "High"
        if n == 2:
            return "Medium"
        return "Low"

    def _fetch_comments(self, client: httpx.Client, wi_id: int) -> list[dict[str, Any]]:
        try:
            resp = client.get(
                f"/_apis/wit/workItems/{wi_id}/comments",
                params={"api-version": "7.1-preview.3"},
            )
            resp.raise_for_status()
        except httpx.HTTPError:
            return []
        data = resp.json()
        result = []
        for c in data.get("comments", []):
            result.append(
                {
                    "who": c.get("createdBy", {}).get("displayName", ""),
                    "when": c.get("createdDate", ""),
                    "text": _strip_html(c.get("text", "")),
                }
            )
        return result

    @staticmethod
    def _parse_relations(relations: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        attachments: list[dict[str, Any]] = []
        linked_prs: list[dict[str, Any]] = []
        for rel in relations:
            rel_type = rel.get("rel", "")
            url = rel.get("url", "")
            attrs = rel.get("attributes", {})
            if rel_type == "AttachedFile":
                attachments.append({"name": attrs.get("name", url.rsplit("/", 1)[-1]), "size": ""})
            elif "PullRequest" in rel_type or "ArtifactLink" in rel_type and "PullRequest" in url:
                linked_prs.append({"repo": "", "num": url.rsplit("/", 1)[-1], "title": "", "status": ""})
        return attachments, linked_prs

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
                f"/_apis/wit/workItems/{ticket_external_id}/comments",
                params={"api-version": "7.1-preview.3"},
                json={"text": body},
            )
            resp.raise_for_status()
            return str(resp.json().get("id", ""))

    def update_status(self, ticket_external_id: str, target_status: str) -> None:
        with self._client() as client:
            resp = client.patch(
                f"/_apis/wit/workitems/{ticket_external_id}?api-version={API_VERSION}",
                headers={"Content-Type": "application/json-patch+json"},
                json=[{"op": "add", "path": "/fields/System.State", "value": target_status}],
            )
            resp.raise_for_status()


register("ado", AzureDevOpsAdapter)
