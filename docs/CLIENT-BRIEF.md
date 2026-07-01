# Q-Agent – Client Brief

## Project Overview

Q-Agent is a **local-first, AI-powered QA Operating System** that automates the software testing lifecycle from requirement analysis to automated execution and feedback.

The platform integrates with project management systems such as Azure DevOps and Jira, uses Claude CLI to understand requirements and generate high-quality test assets, enables QA engineers to review AI-generated work, executes automated tests using Playwright, collects execution evidence, and synchronizes results back to the original ticket.

The goal is to create an AI teammate for QA engineers—not simply another testing tool.

---

# Vision

Build a premium AI-native application that enables QA engineers to:

* Synchronize development tickets
* Analyze requirements with AI
* Generate comprehensive test cases
* Review AI-generated work
* Generate Playwright automation
* Execute tests
* Collect evidence
* Publish results back to Azure DevOps or Jira

The application should feel like a combination of:

* Cursor
* GitHub Actions
* GitHub Pull Requests
* Azure DevOps Pipelines
* Linear
* Vercel Dashboard

rather than a traditional enterprise QA application.

---

# Architecture

The application is **local-first**.

Everything runs locally on the user's machine.

No cloud deployment is required for the MVP.

Components:

* React frontend
* FastAPI backend
* SQLite database
* Claude CLI
* Playwright
* Local workspace

Users should be able to install and run the application with a one-click setup process.

---

# Core Concepts

The application revolves around several core entities.

## Providers

External systems such as:

* Azure DevOps
* Jira
* GitHub

Providers are responsible for:

* Synchronizing tickets
* Publishing comments
* Updating ticket status
* Uploading attachments

---

## Projects

A connected project from Azure DevOps or Jira.

Projects organize tickets.

---

## Tickets

Tickets are imported from providers.

Supported work items include:

* User Stories
* Tasks
* Bugs
* Features

Each ticket contains:

* Description
* Acceptance Criteria
* Comments
* Attachments
* Labels
* Priority
* Status
* Linked Pull Requests

Tickets are read-only representations of work items.

---

## Runs

A Run is the central entity of the application.

A Run represents an entire QA session.

A Run may include:

* One ticket
* Multiple selected tickets
* All assigned tickets
* Sprint tickets

Everything after ticket selection belongs to a Run.

---

# Workflow

The application should guide users through the complete QA lifecycle.

```
Sync Tickets

↓

Select Tickets

↓

Create Run

↓

Read Ticket

↓

Analyze Requirements

↓

Generate Test Cases

↓

Review Test Cases

↓

Generate Playwright Automation

↓

Execute Tests

↓

Collect Evidence

↓

Generate Reports

↓

Prepare Ticket Comments

↓

Publish Results
```

This workflow should be clearly visualized throughout the application.

---

# Integrations

Provide a dedicated Provider Configuration page.

Each provider should support:

### Azure DevOps

* Organization URL
* Project
* Personal Access Token (PAT)
* Test Connection
* Save Configuration
* Connection Status
* Last Synchronization

### Jira

* Base URL
* Email
* API Token
* Project Key
* Test Connection
* Save Configuration
* Connection Status

Future providers should be easy to add through a plugin architecture.

---

# Ticket Synchronization

Users should be able to:

* Pull assigned tickets
* Pull sprint tickets
* Pull selected tickets
* Refresh tickets

After synchronization, tickets become available inside the application.

---

# Ticket Details

Each ticket should have a dedicated details page displaying:

* Description
* Acceptance Criteria
* Notes
* Priority
* Status
* Sprint
* Labels
* Attachments
* Linked Pull Requests
* Comments

QA engineers should not need to switch back to Azure DevOps or Jira while reviewing a ticket.

---

# Run Creation

Users create a Run by selecting one or more tickets.

Supported modes:

* Single Ticket
* Selected Tickets
* Assigned Tickets
* Sprint

Configuration includes:

* Automation Framework
* Browser
* Environment
* Parallel Workers
* Retry Policy

---

# AI Analysis

Claude CLI analyzes every ticket and extracts:

* Business Rules
* Functional Requirements
* Validation Rules
* Risks
* Edge Cases
* Missing Information
* Suggested Test Scope

Display AI reasoning with animated progress and streaming feedback.

---

# Test Case Generation

Claude CLI generates Azure DevOps-style manual test cases.

Each test case should include:

* Title
* Preconditions
* Test Steps
* Expected Results
* Priority
* Test Type
* Automation Type

The generated format should closely match Azure DevOps Test Case structure to simplify synchronization and import.

---

# Review Center

The Review Center is the heart of the application.

This is where QA engineers validate AI-generated work before automation begins.

Review should happen at two levels:

### Ticket Level

Display:

* Number of generated test cases
* Review progress
* Approval status

### Test Case Level

Users can:

* Expand a ticket
* Review individual test cases
* Edit
* Approve
* Reject
* Regenerate
* Add manual test cases

Bulk operations should include:

* Approve All
* Reject Selected
* Regenerate Selected

Automation generation is only allowed for approved test cases.

---

# Automation Generation

Generate automation only after review is complete.

Primary framework:

* Playwright
* TypeScript

Future support:

* Selenium
* Cypress

Provide an automation review page with:

* Syntax highlighting
* Copy
* Download
* Regenerate

---

# Execution

Execution belongs to a Run.

Display:

* Execution Queue
* Current Ticket
* Current Test Case
* Worker Status
* Overall Progress
* Passed
* Failed
* Remaining

Support sequential and parallel execution.

---

# Evidence Collection

Collect evidence for every executed test.

Artifacts include:

* Screenshots
* Videos
* Playwright Trace
* Console Logs
* Network Logs
* Execution Summary

Group evidence by ticket.

---

# Screenshot Annotation

Provide an annotation interface supporting:

* Rectangle
* Arrow
* Highlight
* Circle
* Text

Annotated screenshots will be attached to ticket comments.

---

# Reporting

Generate a comprehensive execution report containing:

* Overall Result
* Ticket Summary
* Passed Tests
* Failed Tests
* AI Failure Analysis
* Execution Time
* Environment
* Evidence

---

# Ticket Synchronization

After execution, prepare comments for Azure DevOps or Jira.

Users can:

* Review comments
* Edit comments
* Publish Selected
* Publish All
* Retry Failed Updates

Support configurable status mapping such as:

Ready for QA

↓

Testing

↓

Passed

or

↓

QA Failed

---

# User Experience

The application should feel like an intelligent AI teammate.

Avoid traditional loading indicators.

Instead, display live AI progress such as:

* Reading ticket...
* Understanding acceptance criteria...
* Identifying business rules...
* Generating test cases...
* Waiting for review...
* Writing Playwright automation...
* Executing tests...
* Collecting evidence...
* Preparing Azure DevOps comment...

The AI should appear continuously active throughout the workflow.

---

# UI & Design

The application should maintain a premium AI-native design language.

Characteristics:

* Dark theme by default
* Glassmorphism
* Soft gradients
* Ambient glow
* Rich micro-interactions
* Smooth animations
* Three.js background effects
* Responsive layouts
* Beautiful dashboards
* Workflow-focused UX

The application should feel more like Cursor or Linear than a traditional enterprise QA dashboard.

---

# Technical Stack

### Frontend

* React 19
* Vite
* TypeScript
* Tailwind CSS
* shadcn/ui
* Framer Motion
* React Three Fiber

### Backend

* FastAPI
* Python

### Database

* SQLite

### AI

* Claude CLI (local execution)

### Automation

* Playwright
* TypeScript

### Image Processing

* Pillow

The architecture should remain extensible for future providers, AI engines, automation frameworks, CI/CD integration, and multi-user collaboration without requiring major changes to the core workflow.
