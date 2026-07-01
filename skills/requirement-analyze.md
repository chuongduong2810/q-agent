# Claude Skill: Requirement Analyst

## Purpose

Analyze software requirements before any test cases or automation are
generated.

This skill transforms raw Azure DevOps or Jira tickets into a structured
Requirement Analysis that becomes the foundation for all downstream AI
workflows.

This skill must be executed before the Test Case Generator.

------------------------------------------------------------------------

## Prerequisites

Required inputs:

-   Azure DevOps or Jira Ticket
-   Project Knowledge Base
-   Business Domain Knowledge
-   Ticket comments
-   Attachments (if available)

If the Project Knowledge Base does not exist, execute the Project
Bootstrap & Codebase Indexing skill first.

------------------------------------------------------------------------

## Inputs

-   Ticket Title
-   Ticket Description
-   Acceptance Criteria
-   Comments
-   Attachments
-   Linked Pull Requests (optional)
-   Project Knowledge Base

------------------------------------------------------------------------

## Objectives

Understand the ticket from both a technical and business perspective.

Produce a structured analysis instead of test cases.

------------------------------------------------------------------------

## Analysis Process

### 1. Requirement Understanding

Identify:

-   Business objective
-   User goal
-   Functional requirements
-   Non-functional requirements
-   Scope
-   Out-of-scope items

------------------------------------------------------------------------

### 2. Acceptance Criteria Analysis

For each Acceptance Criterion:

-   Explain its meaning
-   Identify dependencies
-   Detect ambiguity
-   Identify missing information
-   Determine expected behavior

------------------------------------------------------------------------

### 3. Business Rules

Extract explicit and implicit business rules.

Categorize them as:

-   Validation Rules
-   Workflow Rules
-   Permission Rules
-   Data Rules
-   Calculation Rules

------------------------------------------------------------------------

### 4. Edge Cases

Identify potential:

-   Boundary conditions
-   Empty states
-   Invalid inputs
-   Unexpected user actions
-   Error scenarios
-   Recovery scenarios

------------------------------------------------------------------------

### 5. Risks

Identify:

-   Missing requirements
-   Contradictory requirements
-   Technical risks
-   Business risks
-   Regression risks

Assign a risk level where appropriate.

------------------------------------------------------------------------

### 6. Domain Understanding

Reuse terminology from the Project Knowledge Base.

Map the ticket to:

-   Business entities
-   Existing modules
-   Existing workflows

Never invent domain concepts.

------------------------------------------------------------------------

### 7. Test Scope Recommendation

Recommend testing scope including:

-   Functional Testing
-   Regression Testing
-   Validation Testing
-   Permission Testing
-   UI Testing
-   API Testing (if applicable)
-   Integration Testing (if applicable)

------------------------------------------------------------------------

### 8. Requirement Coverage Plan

Map Acceptance Criteria to proposed testing areas.

Highlight:

-   Covered requirements
-   Missing coverage
-   Suggested additional scenarios

------------------------------------------------------------------------

## Outputs

Generate a structured Requirement Analysis containing:

1.  Executive Summary
2.  Business Objective
3.  Functional Requirements
4.  Non-functional Requirements
5.  Business Rules
6.  Acceptance Criteria Breakdown
7.  Edge Cases
8.  Risks
9.  Assumptions
10. Missing Information
11. Recommended Test Scope
12. Requirement Coverage Plan

------------------------------------------------------------------------

## Quality Rules

-   Do not generate test cases.
-   Do not generate automation code.
-   Do not assume undocumented behavior.
-   Clearly distinguish facts from assumptions.
-   Reuse terminology from the Project Knowledge Base.
-   Identify ambiguity instead of guessing.

------------------------------------------------------------------------

## Success Criteria

The output should provide enough structured information for the Test
Case Generator to create comprehensive Azure DevOps-style test cases
without needing to reinterpret the original ticket.

This skill is responsible for understanding requirements; downstream
skills are responsible for generating test cases and automation.
