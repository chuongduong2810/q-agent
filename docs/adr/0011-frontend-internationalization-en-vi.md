# ADR 0011 — Frontend internationalization (English + Vietnamese)

- **Status:** Accepted
- **Date:** 2026-07-16
- **Deciders:** Operator (via in-session decisions), Q-Agent build
- **Extends:** [ADR 0003](0003-client-side-routing.md) (client-side routing), [ADR 0004](0004-run-workspace-navigation.md) (UI-only state in Zustand)

## Context

The client needs the frontend available in **English (`en`)** and **Vietnamese
(`vi`)**. Today every user-facing string in `app/` is hardcoded English JSX/text
(~90+ `.tsx` files, ~143 toast messages, ~65 input placeholders). There is no
string catalog and no i18n library installed. Language is a pure **display**
concern — it does not affect data, provider payloads, or generated artifacts
(test cases/specs stay in the source language of the ticket).

## Decision

Adopt **`i18next` + `react-i18next`** with **`i18next-browser-languagedetector`**.

### Library & init

- One config module `app/src/i18n/index.ts`, imported for its side effect in
  `main.tsx` **before** `RouterProvider` renders. React 19 + Vite 6 + the data
  router are unaffected — `react-i18next` reads context via the `I18nextProvider`
  Q-Agent wraps at the `App` root.
- Supported languages: `['en', 'vi']`, `fallbackLng: 'en'`, `en` is source.

### Persistence — client-only `localStorage`

Language is a client display preference, so it is **not** a server setting (unlike
the 3D-background flag on `SettingsOut`). The language detector persists the
choice under `localStorage` key **`qagent.lang`** and reads it on boot, matching
the repo's existing raw-`localStorage` convention (`store/tour.ts`,
`CreateLinkSync.tsx`). No backend change, no new migration, instant switch. This
keeps navigation/URL untouched (ADR 0003/0004): language is orthogonal to route.

### Namespaced catalogs auto-loaded via `import.meta.glob` (the parallelism enabler)

Translation resources live per-feature, **one JSON file per namespace per
language**:

```
app/src/i18n/locales/
  en/{common,nav,auth,settings,dashboard,projects,tickets,runs,pipeline,reports,commands}.json
  vi/{common,nav,auth,settings,dashboard,projects,tickets,runs,pipeline,reports,commands}.json
```

The config builds its `resources` object dynamically from
`import.meta.glob('./locales/**/*.json', { eager: true })`. **Adding a namespace
requires zero edits to the config** — a feature slice just drops its two JSON
files and calls `useTranslation('<ns>')`. This is deliberate: it makes the
content slices **file-disjoint** so they build and auto-merge in parallel without
fighting over a central catalog (per the repo's parallel-slice workflow). Default
namespace is `common` (shared verbs: Save, Cancel, Loading, …).

### Language switcher placement

- **Settings → INTERFACE** section (alongside the existing 3D-background toggle) —
  the durable home for the preference.
- A compact switcher in the **TopBar** (`components/shell/`) for one-click access
  from anywhere.

### Keys, not typed unions

`t()` calls use plain string keys; we intentionally **do not** generate a
`react-i18next.d.ts` typed-resources module. A shared declaration file would be a
central file every slice must edit (re-introducing the contention the namespace
split removes), and missing keys fall back to the key text at runtime rather than
breaking `tsc`. Keys are namespaced by convention (`settings.save`, `nav.runs`).

## Consequences

- Switching EN↔VI is instant and client-only; no route, store-navigation, or
  backend change (respects ADR 0003/0004 — no navigation state added to Zustand).
- The ~90-file translation surface is delivered as a **solo foundation** (infra +
  switcher + shell chrome, which touches shared `shell/` files) followed by
  **file-disjoint content slices in one parallel wave**, one namespace each.
- Untranslated keys degrade gracefully to English (the key/fallback) rather than
  crashing — safe for incremental extension of any namespace later.
- Generated artifacts (test cases, specs, comments) and provider payloads are
  **out of scope** — those follow the source ticket's language, not the UI locale.
