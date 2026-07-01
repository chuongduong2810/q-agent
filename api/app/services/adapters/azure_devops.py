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
from urllib.parse import quote

import httpx

from app.logging import logger
from app.services.adapters import register
from app.services.adapters.base import NormalizedTicket, ProviderAdapter, ProviderError

API_VERSION = "7.1"

# QA-relevant work item types across the common ADO process templates (Agile,
# Scrum, Basic). Unknown values in a WIQL IN() list simply don't match — they do
# not cause a 400 — so listing a superset is safe.
_WORK_ITEM_TYPES = (
    "User Story",
    "Product Backlog Item",
    "Bug",
    "Task",
    "Feature",
    "Issue",
)


def _wiql_literal(value: str) -> str:
    """Escape a value for use inside a single-quoted WIQL string literal."""
    return value.replace("'", "''")


class _WiqlError(RuntimeError):
    """A 400 from the WIQL endpoint, carrying ADO's validation message."""


def _classification_path_to_iteration(node_path: str) -> str:
    """Convert a classification-node path to a System.IterationPath value.

    ``\\Surency\\Iteration\\Release 1\\Sprint 3`` -> ``Surency\\Release 1\\Sprint 3``
    (strip the leading separator and the structural ``Iteration`` segment).
    """
    parts = [p for p in node_path.split("\\") if p]
    if len(parts) >= 2 and parts[1] == "Iteration":
        parts = [parts[0]] + parts[2:]
    return "\\".join(parts)


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

    def list_sprints(self) -> list[dict[str, Any]]:
        """Enumerate the project's iterations via classification nodes.

        Uses the project-scoped iteration tree (no team required) and converts each
        node's classification path (``\\Project\\Iteration\\Sprint``) into the
        ``System.IterationPath`` form (``Project\\Sprint``) that WIQL expects.
        """
        project = self.project
        if not project:
            raise ProviderError("Azure DevOps project is not configured")
        with self._client() as client:
            resp = client.get(
                f"/{quote(project)}/_apis/wit/classificationnodes/iterations",
                params={"$depth": 10, "api-version": API_VERSION},
            )
            resp.raise_for_status()
            root = resp.json()

        sprints: list[dict[str, Any]] = []

        def walk(node: dict[str, Any]) -> None:
            for child in node.get("children", []) or []:
                attrs = child.get("attributes") or {}
                sprints.append(
                    {
                        "id": str(child.get("identifier") or child.get("id", "")),
                        "name": child.get("name", ""),
                        "path": _classification_path_to_iteration(child.get("path", "")),
                        "start_date": attrs.get("startDate"),
                        "finish_date": attrs.get("finishDate"),
                    }
                )
                walk(child)

        walk(root)
        return sprints

    # Max work items pulled in a single sync — keeps sync responsive on large sprints.
    MAX_SYNC_ITEMS = 200

    def fetch_tickets(
        self,
        *,
        mode: str = "sprint",
        sprint: str | None = None,
        sprint_path: str | None = None,
        ticket_ids: list[str] | None = None,
        include_comments: bool = False,
    ) -> list[NormalizedTicket]:
        project = self.project
        if not project:
            raise ProviderError("Azure DevOps project is not configured")

        with self._client() as client:
            ids = self._query_work_item_ids(
                client, project, mode=mode, sprint=sprint, sprint_path=sprint_path, ticket_ids=ticket_ids
            )
            if not ids:
                return []
            if len(ids) > self.MAX_SYNC_ITEMS:
                logger.warning(
                    "ADO sync capped at {} of {} work items", self.MAX_SYNC_ITEMS, len(ids)
                )
                ids = ids[: self.MAX_SYNC_ITEMS]
            items = self._get_work_items(client, ids)
            return [self._normalize(client, item, include_comments=include_comments) for item in items]

    def fetch_comments(self, ticket_external_id: str) -> list[dict[str, Any]]:
        try:
            wi_id = int(ticket_external_id)
        except (TypeError, ValueError):
            return []
        with self._client() as client:
            return self._fetch_comments(client, wi_id)

    def _query_work_item_ids(
        self,
        client: httpx.Client,
        project: str,
        *,
        mode: str,
        sprint: str | None,
        sprint_path: str | None,
        ticket_ids: list[str] | None,
    ) -> list[int]:
        if mode == "selected" and ticket_ids:
            return [int(tid) for tid in ticket_ids if str(tid).isdigit()]

        types = ", ".join(f"'{t}'" for t in _WORK_ITEM_TYPES)
        base_conditions = [
            f"[System.TeamProject] = '{_wiql_literal(project)}'",
            f"[System.WorkItemType] IN ({types})",
            "[System.State] <> 'Removed'",
        ]
        conditions = list(base_conditions)
        # Prefer the native iteration path from list_sprints; fall back to project\name.
        iteration = sprint_path or (f"{project}\\{sprint}" if sprint else None)
        if mode == "sprint" and iteration:
            conditions.append(f"[System.IterationPath] UNDER '{_wiql_literal(iteration)}'")
        elif mode == "assigned":
            conditions.append("[System.AssignedTo] = @Me")

        try:
            return self._run_wiql(client, project, conditions)
        except _WiqlError as exc:
            # The most common WIQL 400 is an iteration/area path that does not
            # exist in this project (e.g. a placeholder sprint name). Retry once
            # without the iteration filter so sync still returns the project's
            # work items; otherwise surface ADO's own error message.
            if mode == "sprint" and iteration:
                logger.warning(
                    "ADO WIQL rejected iteration filter ({}); retrying without sprint scope", exc
                )
                return self._run_wiql(client, project, base_conditions)
            raise ProviderError(f"Azure DevOps WIQL query failed: {exc}") from exc

    def _run_wiql(self, client: httpx.Client, project: str, conditions: list[str]) -> list[int]:
        wiql = {
            "query": (
                "SELECT [System.Id] FROM WorkItems WHERE "
                + " AND ".join(conditions)
                + " ORDER BY [System.ChangedDate] DESC"
            )
        }
        resp = client.post(
            f"/{quote(project)}/_apis/wit/wiql?api-version={API_VERSION}",
            json=wiql,
        )
        if resp.status_code == 400:
            try:
                message = resp.json().get("message") or resp.text
            except ValueError:
                message = resp.text
            raise _WiqlError(message.strip())
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

    def _normalize(
        self, client: httpx.Client, item: dict[str, Any], *, include_comments: bool = False
    ) -> NormalizedTicket:
        fields = item.get("fields", {})
        wi_id = item["id"]

        labels = [t.strip() for t in (fields.get("System.Tags") or "").split(";") if t.strip()]
        ac_html = fields.get("Microsoft.VSTS.Common.AcceptanceCriteria", "")
        comments = self._fetch_comments(client, wi_id) if include_comments else []
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
