"""Review Center router — validate AI-generated test cases before automation.

Endpoints to implement:
  GET   /runs/{run_id}/cases                      -> list[TestCaseOut]
  POST  /runs/{run_id}/cases                      -> TestCaseOut        (add manual case; TestCaseCreate)
  PATCH /cases/{case_id}                          -> TestCaseOut        (edit; TestCaseUpdate, sets edited)
  POST  /cases/{case_id}/approval                 -> TestCaseOut        (ApprovalUpdate)
  POST  /cases/{case_id}/regenerate               -> TestCaseOut        (Claude regenerate a single case)
  POST  /runs/{run_id}/approve-all                -> list[TestCaseOut]  (bulk approve non-rejected)
  POST  /runs/{run_id}/tickets/{tid}/approve      -> list[TestCaseOut]  (approve a ticket's cases)

Uses prefix "" (mixes /runs and /cases paths) — declare full paths on each route.
"""

from __future__ import annotations

from fastapi import APIRouter

router = APIRouter(tags=["review"])
