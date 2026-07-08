"""API tests for /tickets sync + list/detail, and /projects refresh."""

from __future__ import annotations

import httpx
import respx


def _configure_ado(client) -> int:
    """Create + configure an ADO work-item connection; return its id."""
    conn = client.post("/providers/ado/connections", json={"name": "ADO"}).json()
    client.put(
        f"/connections/{conn['id']}",
        json={
            "config": {"orgUrl": "https://dev.azure.com/myorg", "project": "MyProj"},
            "secrets": {"pat": "secret-pat"},
        },
    )
    return conn["id"]


@respx.mock
def test_sync_tickets_upserts_and_returns_result(client, db_session):
    connection_id = _configure_ado(client)

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
                            "System.Description": "<p>Body</p>",
                            "System.Tags": "auth",
                            "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>- AC1</p>",
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

    resp = client.post(
        "/tickets/sync",
        json={"connectionId": connection_id, "mode": "sprint", "sprint": "Sprint 12"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["synced"] == 1
    assert body["tickets"][0]["externalId"] == "101"
    assert body["tickets"][0]["priority"] == "High"

    # persisted and retrievable via GET /tickets
    list_resp = client.get("/tickets")
    assert list_resp.status_code == 200
    assert len(list_resp.json()) == 1

    # The synced ticket is stamped with the work-item connection it came from.
    from app.models.ticket import Ticket

    db_session.expire_all()
    stamped = db_session.query(Ticket).filter(Ticket.external_id == "101").first()
    assert stamped.connection_id == connection_id


@respx.mock
def test_sync_tickets_unknown_provider_404(client):
    resp = client.post("/tickets/sync", json={"providerKind": "ado", "mode": "sprint"})
    assert resp.status_code == 404


@respx.mock
def test_get_ticket_detail(client):
    connection_id = _configure_ado(client)
    respx.post("https://dev.azure.com/myorg/MyProj/_apis/wit/wiql").mock(
        return_value=httpx.Response(200, json={"workItems": [{"id": 202}]})
    )
    respx.get("https://dev.azure.com/myorg/_apis/wit/workitems").mock(
        return_value=httpx.Response(
            200,
            json={
                "value": [
                    {
                        "id": 202,
                        "fields": {
                            "System.Title": "Signup form validation",
                            "System.WorkItemType": "User Story",
                            "System.State": "In Progress",
                            "Microsoft.VSTS.Common.Priority": 2,
                            "System.AssignedTo": {"displayName": "Maya Kaur"},
                            "System.IterationPath": "MyProj\\Sprint 12",
                            "System.Description": "<p>Detail body</p>",
                            "System.Tags": "",
                            "Microsoft.VSTS.Common.AcceptanceCriteria": "<p>- AC1</p><p>- AC2</p>",
                        },
                        "relations": [],
                    }
                ]
            },
        )
    )
    respx.get("https://dev.azure.com/myorg/_apis/wit/workItems/202/comments").mock(
        return_value=httpx.Response(
            200, json={"comments": [{"createdBy": {"displayName": "Bob"}, "text": "LGTM"}]}
        )
    )

    client.post(
        "/tickets/sync",
        json={"connectionId": connection_id, "mode": "sprint", "sprint": "Sprint 12"},
    )

    detail_resp = client.get("/tickets/202")
    assert detail_resp.status_code == 200
    detail = detail_resp.json()
    assert detail["externalId"] == "202"
    assert detail["description"] == "Detail body"
    assert detail["acceptanceCriteria"] == ["AC1", "AC2"]
    assert detail["comments"][0]["text"] == "LGTM"


def test_get_ticket_detail_not_found(client):
    resp = client.get("/tickets/does-not-exist")
    assert resp.status_code == 404


def test_list_tickets_filters_by_status(client, db_session):
    from app.models.ticket import Ticket

    db_session.add(
        Ticket(external_id="1", provider_kind="ado", title="A", status="Done", priority="Low")
    )
    db_session.add(
        Ticket(
            external_id="2",
            provider_kind="ado",
            title="B",
            status="Ready for QA",
            priority="High",
        )
    )
    db_session.commit()

    resp = client.get("/tickets", params={"status": "Ready for QA"})
    assert resp.status_code == 200
    results = resp.json()
    assert len(results) == 1
    assert results[0]["externalId"] == "2"


@respx.mock
def test_projects_refresh_upserts_from_connected_providers(client):
    connection_id = _configure_ado(client)

    respx.get("https://dev.azure.com/myorg/_apis/projects", params={"api-version": "7.1"}).mock(
        return_value=httpx.Response(200, json={"count": 1, "value": [{"id": "p1", "name": "MyProj"}]})
    )

    # Mark the connection connected via the real test-connection endpoint first.
    resp_test = client.post(f"/connections/{connection_id}/test")
    assert resp_test.status_code == 200

    resp = client.post("/projects/refresh")
    assert resp.status_code == 200
    projects = resp.json()
    assert len(projects) == 1
    assert projects[0]["externalId"] == "p1"
    assert projects[0]["name"] == "MyProj"

    list_resp = client.get("/projects")
    assert len(list_resp.json()) == 1
