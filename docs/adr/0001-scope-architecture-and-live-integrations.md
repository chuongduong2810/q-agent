# ADR 0001 — Scope, architecture, and live integrations

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** Client (via scope confirmation), Q-Agent build

## Context

The Client Brief (`docs/CLIENT-BRIEF.md`) describes a local-first, AI-powered QA
Operating System spanning a React frontend, FastAPI backend, SQLite, Claude CLI,
Playwright, and Azure DevOps / Jira / GitHub provider integrations. A polished UI
prototype already exists (`design/Q-Agent app design/Q-Agent.dc.html`) with the
full screen set and a scripted, simulated pipeline over mock data.

Two forks materially change the build shape and had to be settled before slicing
work across parallel agents:

1. **How much of the stack to build** (frontend only vs. full-stack).
2. **How the AI + automation engines behave** (simulated vs. real, with/without
   fallback).

## Decision

1. **Build the full stack, local-first.** React (`app/`) + FastAPI (`api/`) +
   SQLite, no cloud. One-click setup/start scripts.
2. **Live integrations, real engines, no fallback.**
   - Provider adapters (ADO / Jira / GitHub) call the real REST APIs via `httpx`.
   - Claude CLI is invoked via subprocess for requirement analysis, test-case
     generation, and Playwright spec generation.
   - Playwright genuinely executes the generated specs and captures artifacts.
   - There is **no** simulated/mock fallback path in product code. (Tests may mock
     transport to exercise our own logic, but the app talks to real systems.)
3. **Monorepo:** `app/` frontend, `api/` backend, `scripts/` packaging,
   `docs/`, `design/`, `template/`.
4. **Frontend fidelity:** reproduce the approved design 1:1, then wire it to the
   live backend (TanStack Query for server state, WebSocket for live pipeline
   progress, Zustand for UI-only state).
5. **Credentials encrypted at rest** (Fernet key derived from a local secret);
   PATs/tokens never returned in plaintext by the API.

## Consequences

- **Positive:** Delivers the brief's true MVP — a demoable, real product. Extensible
  adapter/engine seams keep future providers and frameworks cheap to add.
- **Cost / risk:** Full end-to-end validation requires the operator's environment
  — real ADO/Jira credentials, an authenticated Claude CLI, and installed
  Playwright browsers. In this build environment those externals cannot be
  exercised against live tenants, so verification relies on: type-checking, unit
  tests with mocked transport, backend boot/import checks, frontend build, and
  Playwright **visual** screenshots of the UI. Live-tenant validation is an
  operator step, documented in the README.
- **No fallback** means the app surfaces real errors when an engine/provider is
  unavailable, rather than silently simulating — intentional, per client choice.

## Alternatives considered

- *Frontend-first with mock data* — fastest to a beautiful clickable app, but
  defers all real value; rejected per client.
- *Full-stack with mock/fixture fallback* — runs credential-free everywhere, but
  the client explicitly wanted real engines only; rejected.

## Library scope note

The suggested stack (`docs/SUGGEST-TECHSTACK.md`) lists many optional libraries.
We adopt those the product actually needs (React 19, Vite, TS, Tailwind 4,
shadcn-style primitives, Framer Motion, React Three Fiber, TanStack Query,
Zustand, lucide, sonner, cmdk; FastAPI, SQLAlchemy 2, Pydantic v2, Alembic,
httpx, Loguru, Pillow, Playwright) and defer speculative ones to keep the surface
lean (per repo coding standards).
