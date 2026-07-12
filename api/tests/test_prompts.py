"""Tests for prompt builders in ``app.services.prompts`` (#182 relevance ranking)."""

from __future__ import annotations

from app.services.prompts import render_project_context


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
