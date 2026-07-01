# Claude Skill: Test Case Generator

## Purpose

Generate high-quality manual test cases from software requirements using
the previously generated **Project Knowledge Base**.

This skill should never work from the ticket alone. It must combine the
ticket, project knowledge, business domain knowledge, coding
conventions, and existing automation patterns to produce comprehensive,
review-ready test cases.

------------------------------------------------------------------------

## Prerequisites

The following inputs should already exist:

-   Project Knowledge Base
-   Indexed codebase
-   Azure DevOps or Jira ticket
-   Acceptance Criteria
-   Business domain glossary

If the Project Knowledge Base does not exist, request that the **Project
Bootstrap & Codebase Indexing** skill be executed first.

------------------------------------------------------------------------

## Inputs

-   Ticket title
-   Ticket description
-   Acceptance Criteria
-   Comments
-   Attachments (if available)
-   Project Knowledge Base

------------------------------------------------------------------------

## Objectives

Generate complete, review-ready manual test cases that:

-   Cover every Acceptance Criterion
-   Include happy path scenarios
-   Include negative scenarios
-   Include boundary value scenarios
-   Consider validation rules
-   Consider permissions and security
-   Reuse project terminology
-   Follow Azure DevOps Test Case format

------------------------------------------------------------------------

## Analysis Process

Before generating test cases:

1.  Understand the business objective.
2.  Identify functional requirements.
3.  Extract validation rules.
4.  Detect edge cases.
5.  Detect missing requirements.
6.  Identify assumptions and risks.
7.  Map Acceptance Criteria to test coverage.

------------------------------------------------------------------------

## Coverage Rules

Generate test cases for:

-   Happy paths
-   Negative paths
-   Boundary values
-   Required field validation
-   Optional field validation
-   Invalid inputs
-   Permission and role-based access
-   Error handling
-   Empty states
-   Duplicate data
-   Business rule validation
-   Regression risks

Do not generate duplicate test cases.

------------------------------------------------------------------------

## Azure DevOps Test Case Format

Each generated test case should include:

-   Title
-   Objective
-   Preconditions
-   Test Data
-   Test Steps
-   Expected Results
-   Priority
-   Test Type
-   Automation Candidate (Yes/No)
-   Notes

Use clear, concise, and business-friendly language.

------------------------------------------------------------------------

## Requirement Coverage

For every Acceptance Criterion:

-   List related test cases.
-   Report uncovered requirements.
-   Suggest additional scenarios when coverage is incomplete.

Generate a Requirement Coverage Summary.

------------------------------------------------------------------------

## Quality Rules

-   Prefer completeness over quantity.
-   Never invent undocumented functionality.
-   Clearly identify assumptions.
-   Reuse business terminology from the Project Knowledge Base.
-   Ensure each test case has measurable expected results.
-   Avoid duplicate or overlapping scenarios.

------------------------------------------------------------------------

## Outputs

Produce:

1.  Requirement Analysis Summary
2.  Requirement Coverage Matrix
3.  Azure DevOps-style Test Cases
4.  Risks and Assumptions
5.  Missing Information
6.  Automation Candidates

------------------------------------------------------------------------

## Success Criteria

A QA engineer should be able to review and approve the generated test
cases with minimal edits.

The generated output should be suitable for direct import into Azure
DevOps Test Cases and serve as the source for future Playwright
TypeScript automation generation.
