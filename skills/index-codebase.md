# Claude Skill: Project Bootstrap & Codebase Indexing

## Purpose

This skill is responsible for learning a software project **before**
generating any test cases or automation.

The goal is to build a reusable **Project Knowledge Base** so future AI
tasks can generate high-quality Playwright automation that follows the
existing architecture, coding standards, and domain conventions.

------------------------------------------------------------------------

## Objectives

1.  Detect the technology stack.
2.  Discover the project architecture.
3.  Identify existing automation assets.
4.  Learn coding conventions.
5.  Learn business domain terminology.
6.  Build a reusable project knowledge base.
7.  Save the knowledge base for future prompts.

------------------------------------------------------------------------

## Inputs

-   Local project directory
-   Source repository (already cloned locally)
-   README.md
-   docs/
-   Architecture documents
-   Existing automation project (if any)

------------------------------------------------------------------------

## Constraints

-   Read-only analysis.
-   Never modify source code.
-   Never generate automation during indexing.
-   Never install dependencies unless explicitly requested.

------------------------------------------------------------------------

## Analysis Checklist

### Project Overview

-   Project purpose
-   Technology stack
-   Languages
-   Frameworks
-   Build tools
-   Package managers

### Architecture

-   Frontend framework
-   Backend framework
-   Folder structure
-   Module boundaries

### Automation

Detect: - Playwright - Selenium - Cypress - WebdriverIO

Collect: - Existing tests - Fixtures - Helpers - Page Objects -
Utilities

### Locator Strategy

Determine preferred selectors: - data-testid - ARIA roles - CSS -
XPath - Text

### Authentication

Identify reusable authentication methods.

### Page Objects

List discovered Page Objects and their responsibilities.

### Shared Utilities

Identify reusable testing helpers and utilities.

### Business Domain

Read available documentation and extract: - Business entities - Business
rules - User roles - Core workflows - Domain terminology

### Coding Standards

Learn: - Naming conventions - Folder conventions - Assertion style -
Async patterns - Error handling - Comments

------------------------------------------------------------------------

## Output

Generate a reusable **Project Knowledge Base** containing:

-   Executive Summary
-   Technology Stack
-   Architecture Overview
-   Automation Overview
-   Folder Structure
-   Coding Standards
-   Locator Strategy
-   Authentication Strategy
-   Existing Page Objects
-   Shared Utilities
-   Business Domain Glossary
-   Reusable Patterns
-   Risks
-   Missing Information
-   Recommendations

------------------------------------------------------------------------

## Quality Rules

-   Prefer existing project patterns over generic solutions.
-   Reuse existing helpers whenever possible.
-   Reuse existing Page Objects.
-   Never invent APIs or components.
-   Clearly state uncertainty where information is missing.

------------------------------------------------------------------------

## Success Criteria

After this skill completes, future AI tasks should be able to:

-   Generate Playwright TypeScript automation matching the project's
    conventions.
-   Reuse existing automation assets.
-   Follow coding standards.
-   Use the correct locator strategy.
-   Understand the project's business domain.
-   Produce maintainable automation instead of generic examples.

Always execute this skill once before generating automation for a new
project.
