"""Tests for per-work-item target repositories on a run.

Covers the run-repo endpoints, repo-scoped project context, and the pipeline
storing a validated ``RunTicket.repo`` from Claude's ``suggestedRepo`` guess.
"""

from __future__ import annotations

from app.models.knowledge import ProjectKnowledge, compose_key
from app.models.provider_connection import ProviderConnection
from app.models.run import Run, RunTicket
from app.services import ai_service, project_config_service


def _seed_provider(db):
    db.add(ProviderConnection(kind="ado", name="ADO", connected=True,
                              config={"project": "Surency Platform"}, secrets={}))
    db.commit()


def _seed_repos(client):
    client.put(
        "/projects/Surency Platform/config",
        json={"repos": [
            {"name": "surency-web", "repoUrl": "https://ado/o/_git/surency-web", "default": True},
            {"name": "surency-api", "repoUrl": "https://ado/o/_git/surency-api"},
        ]},
    )


def _seed_knowledge(db, project_key, repo, domain):
    db.add(ProjectKnowledge(
        key=compose_key(project_key, repo), project_key=project_key, name=project_key,
        repo=repo, status="indexed", knowledge={"domain": domain, "stack": ["React"]},
    ))
    db.commit()


def _make_run(db, ticket_external_id):
    run = Run(code="RUN-300", name="Test run", env="Staging", status="review")
    db.add(run)
    db.flush()
    db.add(RunTicket(run_id=run.id, ticket_external_id=ticket_external_id, position=0))
    db.commit()
    db.refresh(run)
    return run


def test_list_run_repos(client, db_session, seed_ticket):
    _seed_provider(db_session)
    _seed_repos(client)
    _seed_knowledge(db_session, "Surency Platform", "surency-web", "WEB")
    run = _make_run(db_session, seed_ticket.external_id)

    repos = client.get(f"/runs/{run.id}/repos").json()
    assert {r["name"] for r in repos} == {"surency-web", "surency-api"}
    web = next(r for r in repos if r["name"] == "surency-web")
    api = next(r for r in repos if r["name"] == "surency-api")
    assert web["default"] is True
    assert web["status"] == "indexed"
    assert api["status"] == "not_indexed"


def test_set_run_ticket_repo(client, db_session, seed_ticket):
    _seed_provider(db_session)
    _seed_repos(client)
    run = _make_run(db_session, seed_ticket.external_id)

    resp = client.post(
        f"/runs/{run.id}/tickets/{seed_ticket.external_id}/repo", json={"repo": "surency-api"}
    )
    assert resp.status_code == 200
    assert resp.json()["repo"] == "surency-api"

    db_session.expire_all()
    rt = db_session.query(RunTicket).filter(RunTicket.run_id == run.id).first()
    assert rt.repo == "surency-api"


def test_set_run_ticket_repo_reset_to_default(client, db_session, seed_ticket):
    _seed_provider(db_session)
    _seed_repos(client)
    run = _make_run(db_session, seed_ticket.external_id)
    client.post(f"/runs/{run.id}/tickets/{seed_ticket.external_id}/repo", json={"repo": "surency-api"})

    resp = client.post(f"/runs/{run.id}/tickets/{seed_ticket.external_id}/repo", json={"repo": ""})
    assert resp.status_code == 200
    assert resp.json()["repo"] == ""


def test_set_run_ticket_repo_unknown_400(client, db_session, seed_ticket):
    _seed_provider(db_session)
    _seed_repos(client)
    run = _make_run(db_session, seed_ticket.external_id)

    resp = client.post(
        f"/runs/{run.id}/tickets/{seed_ticket.external_id}/repo", json={"repo": "ghost"}
    )
    assert resp.status_code == 400


def test_set_run_ticket_repo_404(client, db_session, seed_ticket):
    _seed_provider(db_session)
    _seed_repos(client)
    run = _make_run(db_session, seed_ticket.external_id)

    assert client.post("/runs/9999/tickets/x/repo", json={"repo": ""}).status_code == 404
    resp = client.post(f"/runs/{run.id}/tickets/SUR-0000/repo", json={"repo": ""})
    assert resp.status_code == 404


def test_build_context_loads_target_repo_knowledge(client, db_session):
    from app.models.ticket import Ticket

    _seed_provider(db_session)
    _seed_repos(client)
    _seed_knowledge(db_session, "Surency Platform", "surency-web", "WEB-DOMAIN")
    _seed_knowledge(db_session, "Surency Platform", "surency-api", "API-DOMAIN")
    ticket = Ticket(external_id="SUR-1", provider_kind="ado", title="t")
    db_session.add(ticket)
    db_session.commit()

    # Default (no repo) -> the default repo's KB (surency-web).
    ctx_default = project_config_service.build_context(db_session, ticket)
    assert ctx_default["repo"] == "surency-web"
    assert ctx_default["domain"] == "WEB-DOMAIN"
    assert {o["name"] for o in ctx_default["repoOptions"]} == {"surency-web", "surency-api"}

    # Explicit repo -> that repo's KB.
    ctx_api = project_config_service.build_context(db_session, ticket, repo="surency-api")
    assert ctx_api["repo"] == "surency-api"
    assert ctx_api["domain"] == "API-DOMAIN"


def test_pipeline_stores_validated_repo_from_suggestion(client, db_session, seed_ticket, monkeypatch):
    _seed_provider(db_session)
    _seed_repos(client)
    run = _make_run(db_session, seed_ticket.external_id)

    analysis = {
        "businessRules": [], "functionalRequirements": [], "validationRules": [],
        "risks": [], "edgeCases": [], "missingInformation": [],
        "suggestedScope": "scope", "suggestedRepo": "surency-api",
    }
    responses = iter(
        [{"analysis": analysis, "cases": []}, {"verdict": "approve", "coverageGaps": [], "additionalCases": []}]
    )
    monkeypatch.setattr(ai_service, "run_json", lambda *a, **k: next(responses))

    ai_service.run_generation_pipeline(run.id, blocking=True)

    db_session.expire_all()
    rt = db_session.query(RunTicket).filter(RunTicket.run_id == run.id).first()
    assert rt.repo == "surency-api"


def test_pipeline_falls_back_to_default_repo_on_bad_suggestion(
    client, db_session, seed_ticket, monkeypatch
):
    _seed_provider(db_session)
    _seed_repos(client)
    run = _make_run(db_session, seed_ticket.external_id)

    analysis = {
        "businessRules": [], "functionalRequirements": [], "validationRules": [],
        "risks": [], "edgeCases": [], "missingInformation": [],
        "suggestedScope": "scope", "suggestedRepo": "nonexistent-repo",
    }
    responses = iter(
        [{"analysis": analysis, "cases": []}, {"verdict": "approve", "coverageGaps": [], "additionalCases": []}]
    )
    monkeypatch.setattr(ai_service, "run_json", lambda *a, **k: next(responses))

    ai_service.run_generation_pipeline(run.id, blocking=True)

    db_session.expire_all()
    rt = db_session.query(RunTicket).filter(RunTicket.run_id == run.id).first()
    assert rt.repo == "surency-web"  # project default
