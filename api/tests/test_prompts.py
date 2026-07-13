"""Tests for prompt builders in ``app.services.prompts`` (#182 relevance ranking)."""

from __future__ import annotations

from app.services.prompts import render_dom_snapshot, render_project_context


def test_render_project_context_ranks_routes_by_relevance():
    """With more routes than the injected cap, the one relevant to the query
    survives instead of being cut by a blind ``[:20]`` slice."""
    routes = [{"path": f"/noise-{i}", "description": "unrelated"} for i in range(25)]
    routes.append({"path": "/invoices/refund", "description": "Refund an invoice"})
    context = {"projectKey": "P", "routes": routes}

    block = render_project_context(context, rank_query="Refund an invoice from the invoices screen")
    assert "/invoices/refund" in block


def test_render_project_context_ranks_selectors_by_relevance():
    selectors = [
        {"screen": "Noise", "element": f"el-{i}", "selector": f"#noise-{i}"} for i in range(35)
    ]
    selectors.append({"screen": "Login", "element": "SubmitButton", "selector": "#login-submit"})
    context = {"projectKey": "P", "selectors": selectors}

    block = render_project_context(context, rank_query="Submit the login form")
    assert "#login-submit" in block


def test_render_project_context_no_query_keeps_prior_blind_slice_order():
    """Empty ``rank_query`` (the default) must not change existing behavior: the
    first N items in KB order are kept, exactly like the old ``[:20]`` slice."""
    routes = [{"path": f"/r{i}", "description": ""} for i in range(25)]
    context = {"projectKey": "P", "routes": routes}

    block = render_project_context(context)
    assert "/r0" in block
    assert "/r19" in block
    assert "/r20" not in block
    assert "/r24" not in block


def test_render_dom_snapshot_lists_identified_elements():
    """The distilled DOM block surfaces real element identifiers and the current page."""
    snapshot = {
        "path": "/login",
        "elements": [
            {"tag": "input", "testId": "email", "type": "email"},
            {"tag": "button", "role": "button", "text": "Sign in"},
            {"tag": "div"},  # anonymous — no identifier
        ],
    }
    block = render_dom_snapshot(snapshot)
    assert "Live DOM captured at failure" in block
    assert "/login" in block
    assert "testid='email'" in block
    assert "text='Sign in'" in block


def test_render_dom_snapshot_empty_is_blank():
    assert render_dom_snapshot(None) == ""
    assert render_dom_snapshot({"elements": []}) == ""


def test_build_fix_prompt_includes_discovered_selector():
    """A DOM snapshot passed to the fixer prompt surfaces its real selectors."""
    from types import SimpleNamespace

    from app.services.spec_service import _build_fix_prompt

    case = SimpleNamespace(
        title="Sign in", precondition=None, steps=[],
        ticket_external_id="TCK-1", code="TC-01",
    )
    snapshot = {"path": "/login", "elements": [{"tag": "input", "testId": "username"}]}
    prompt = _build_fix_prompt(
        case, "test('Sign in', async () => {});", "locator not found",
        dom_snapshot=snapshot,
    )
    assert "Live DOM captured at failure" in prompt
    assert "testid='username'" in prompt
