"""Unit tests for provider adapters: normalization + connectivity, HTTP mocked via respx."""

from __future__ import annotations

import base64

import httpx
import pytest
import respx

from app.services.adapters.azure_devops import AzureDevOpsAdapter
from app.services.adapters.base import ProviderError
from app.services.adapters.github import GitHubAdapter
from app.services.adapters.jira import JiraAdapter


# ---------------------------------------------------------------- Azure DevOps
@respx.mock
def test_ado_test_connection_ok():
    adapter = AzureDevOpsAdapter(
        config={"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
        secrets={"pat": "secret-pat"},
    )
    respx.get("https://dev.azure.com/myorg/_apis/projects", params={"api-version": "7.1"}).mock(
        return_value=httpx.Response(200, json={"count": 2, "value": []})
    )
    result = adapter.test_connection()
    assert result["ok"] is True
    assert "2 projects" in result["message"]


def test_ado_test_connection_missing_pat():
    adapter = AzureDevOpsAdapter(config={"orgUrl": "https://dev.azure.com/myorg"}, secrets={})
    result = adapter.test_connection()
    assert result["ok"] is False
    assert "PAT" in result["message"]


@respx.mock
def test_ado_fetch_tickets_normalizes_fields():
    adapter = AzureDevOpsAdapter(
        config={"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
        secrets={"pat": "secret-pat"},
    )
    respx.post("https://dev.azure.com/myorg/MyProj/_apis/wit/wiql").mock(
        return_value=httpx.Response(200, json={"workItems": [{"id": 101}]})
    )
    respx.get("https://dev.azure.com/myorg/_apis/wit/workitems").mock(
        return_value=httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": 101,
                        "fields": {
                            "System.Title": "Login should reject bad password",
                            "System.WorkItemType": "User Story",
                            "System.State": "Ready for QA",
                            "Microsoft.VSTS.Common.Priority": 1,
                            "System.AssignedTo": {"displayName": "Maya Kaur"},
                            "System.IterationPath": "MyProj\\Sprint 12",
                            "System.Description": "<p>As a user I want...</p>",
                            "System.Tags": "auth; security",
                            "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>- AC1</p><p>- AC2</p>",
                        },
                        "relations": [],
                    }
                ]
            },
        )
    )
    respx.get("https://dev.azure.com/myorg/_apis/wit/workItems/101/comments").mock(
        return_value=httpx.Response(200, json={"comments": []})
    )

    tickets = adapter.fetch_tickets(mode="sprint", sprint="Sprint 12")
    assert len(tickets) == 1
    t = tickets[0]
    assert t["external_id"] == "101"
    assert t["title"] == "Login should reject bad password"
    assert t["priority"] == "High"
    assert t["assignee"] == "Maya Kaur"
    assert t["sprint"] == "Sprint 12"
    assert t["labels"] == ["auth", "security"]
    assert t["acceptance_criteria"] == ["AC1", "AC2"]


@respx.mock
def test_ado_fetch_tickets_retries_without_iteration_when_sprint_path_invalid():
    """A WIQL 400 from a non-existent sprint path retries without the filter."""
    import json as _json

    adapter = AzureDevOpsAdapter(
        config={"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
        secrets={"pat": "secret-pat"},
    )
    wiql = respx.post("https://dev.azure.com/myorg/MyProj/_apis/wit/wiql").mock(
        side_effect=[
            httpx.Response(
                400,
                json={"message": "VS402371: The iteration path 'MyProj\\Nope' does not exist."},
            ),
            httpx.Response(200, json={"workItems": [{"id": 7}]}),
        ]
    )
    respx.get("https://dev.azure.com/myorg/_apis/wit/workitems").mock(
        return_value=httpx.Response(
            200, json={"value": [{"id": 7, "fields": {"System.Title": "T"}, "relations": []}]}
        )
    )
    respx.get("https://dev.azure.com/myorg/_apis/wit/workItems/7/comments").mock(
        return_value=httpx.Response(200, json={"comments": []})
    )

    tickets = adapter.fetch_tickets(mode="sprint", sprint="Nope")
    assert len(tickets) == 1 and tickets[0]["external_id"] == "7"
    assert wiql.call_count == 2
    first = _json.loads(wiql.calls[0].request.content)["query"]
    second = _json.loads(wiql.calls[1].request.content)["query"]
    assert "IterationPath" in first and "IterationPath" not in second


@respx.mock
def test_ado_list_sprints_converts_iteration_paths():
    adapter = AzureDevOpsAdapter(
        config={"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
        secrets={"pat": "secret-pat"},
    )
    respx.get(
        "https://dev.azure.com/myorg/MyProj/_apis/wit/classificationnodes/iterations"
    ).mock(
        return_value=httpx.Response(
            200,
            json={
                "name": "MyProj",
                "path": "\\MyProj\\Iteration",
                "children": [
                    {
                        "name": "Sprint 1",
                        "identifier": "a1",
                        "path": "\\MyProj\\Iteration\\Sprint 1",
                        "attributes": {"startDate": "2026-01-01T00:00:00Z"},
                    },
                    {
                        "name": "Release 1",
                        "identifier": "r1",
                        "path": "\\MyProj\\Iteration\\Release 1",
                        "children": [
                            {
                                "name": "Sprint 2",
                                "identifier": "a2",
                                "path": "\\MyProj\\Iteration\\Release 1\\Sprint 2",
                            }
                        ],
                    },
                ],
            },
        )
    )
    sprints = {s["name"]: s["path"] for s in adapter.list_sprints()}
    assert sprints["Sprint 1"] == "MyProj\\Sprint 1"  # IterationPath form (no \Iteration)
    assert sprints["Release 1"] == "MyProj\\Release 1"
    assert sprints["Sprint 2"] == "MyProj\\Release 1\\Sprint 2"  # nested preserved


@respx.mock
def test_ado_fetch_tickets_raises_provider_error_on_non_sprint_wiql_400():
    adapter = AzureDevOpsAdapter(
        config={"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
        secrets={"pat": "secret-pat"},
    )
    respx.post("https://dev.azure.com/myorg/MyProj/_apis/wit/wiql").mock(
        return_value=httpx.Response(400, json={"message": "Bad query"})
    )
    with pytest.raises(ProviderError):
        adapter.fetch_tickets(mode="assigned")


@respx.mock
def test_ado_publish_comment_uses_basic_auth():
    adapter = AzureDevOpsAdapter(
        config={"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
        secrets={"pat": "secret-pat"},
    )
    route = respx.post(
        "https://dev.azure.com/myorg/_apis/wit/workItems/101/comments"
    ).mock(return_value=httpx.Response(200, json={"id": 555}))

    comment_id = adapter.publish_comment("101", "All tests passed")
    assert comment_id == "555"
    sent = route.calls[0].request
    expected_token = base64.b64encode(b":secret-pat").decode()
    assert sent.headers["Authorization"] == f"Basic {expected_token}"


# ---------------------------------------------------------------- Jira
@respx.mock
def test_jira_test_connection_ok():
    adapter = JiraAdapter(
        config={"baseUrl": "https://myorg.atlassian.net", "project": "SUR"},
        secrets={"email": "qa@myorg.com", "apiToken": "tok"},
    )
    respx.get("https://myorg.atlassian.net/rest/api/3/myself").mock(
        return_value=httpx.Response(200, json={"displayName": "Maya Kaur", "accountId": "abc"})
    )
    result = adapter.test_connection()
    assert result["ok"] is True
    assert "Maya Kaur" in result["message"]


def test_jira_test_connection_missing_credentials():
    adapter = JiraAdapter(config={"baseUrl": "https://myorg.atlassian.net"}, secrets={})
    result = adapter.test_connection()
    assert result["ok"] is False


@respx.mock
def test_jira_fetch_tickets_normalizes_adf_description():
    adapter = JiraAdapter(
        config={"baseUrl": "https://myorg.atlassian.net", "project": "SUR"},
        secrets={"email": "qa@myorg.com", "apiToken": "tok"},
    )
    respx.post("https://myorg.atlassian.net/rest/api/3/search/jql").mock(
        return_value=httpx.Response(
            200,
            json={
                "issues": [
                    {
                        "key": "SUR-1428",
                        "fields": {
                            "summary": "Cart total miscalculates tax",
                            "status": {"name": "Ready for QA"},
                            "priority": {"name": "High"},
                            "assignee": {"displayName": "Maya Kaur"},
                            "issuetype": {"name": "Bug"},
                            "labels": ["billing"],
                            "description": {
                                "type": "doc",
                                "version": 1,
                                "content": [
                                    {
                                        "type": "paragraph",
                                        "content": [{"type": "text", "text": "Tax should be 8%."}],
                                    }
                                ],
                            },
                            "comment": {"comments": []},
                            "attachment": [],
                        },
                    }
                ]
            },
        )
    )

    tickets = adapter.fetch_tickets(mode="sprint", sprint="Sprint 12")
    assert len(tickets) == 1
    t = tickets[0]
    assert t["external_id"] == "SUR-1428"
    assert t["priority"] == "High"
    assert "Tax should be 8%." in t["description"]
    assert t["labels"] == ["billing"]


# ---------------------------------------------------------------- GitHub
@respx.mock
def test_github_test_connection_ok():
    adapter = GitHubAdapter(config={"org": "acme", "repo": "webapp"}, secrets={"pat": "ghp_xxx"})
    respx.get("https://api.github.com/user").mock(
        return_value=httpx.Response(200, json={"login": "duna"})
    )
    result = adapter.test_connection()
    assert result["ok"] is True
    assert "duna" in result["message"]


def test_github_test_connection_missing_pat():
    adapter = GitHubAdapter(config={"org": "acme", "repo": "webapp"}, secrets={})
    result = adapter.test_connection()
    assert result["ok"] is False


@respx.mock
def test_github_fetch_tickets_normalizes_issue():
    adapter = GitHubAdapter(config={"org": "acme", "repo": "webapp"}, secrets={"pat": "ghp_xxx"})
    respx.get("https://api.github.com/repos/acme/webapp/issues").mock(
        return_value=httpx.Response(
            200,
            json=[
                {
                    "number": 42,
                    "title": "Checkout button disabled on Safari",
                    "state": "open",
                    "labels": [{"name": "priority:high"}],
                    "assignee": {"login": "maya"},
                    "body": "Steps to reproduce...",
                    "comments": 0,
                }
            ],
        )
    )

    tickets = adapter.fetch_tickets(mode="sprint")
    assert len(tickets) == 1
    t = tickets[0]
    assert t["external_id"] == "42"
    assert t["status"] == "In Progress"
    assert t["priority"] == "High"
    assert t["assignee"] == "maya"


@respx.mock
def test_github_publish_comment():
    adapter = GitHubAdapter(config={"org": "acme", "repo": "webapp"}, secrets={"pat": "ghp_xxx"})
    respx.post("https://api.github.com/repos/acme/webapp/issues/42/comments").mock(
        return_value=httpx.Response(201, json={"id": 999})
    )
    comment_id = adapter.publish_comment("42", "Automation passed.")
    assert comment_id == "999"


def test_adapter_raises_provider_error_without_config():
    adapter = GitHubAdapter(config={}, secrets={})
    with pytest.raises(ProviderError):
        adapter.fetch_tickets(mode="sprint")
