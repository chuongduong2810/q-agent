"""Placeholder / invented-reference gate for generated Playwright specs.

Pure, DB-free heuristics that inspect a generated spec's *source code* and decide
whether it is safe to run. The gate catches two failure modes of AI spec
generation:

1. **Placeholders** — the model emitted a stand-in (``TODO``, ``FIXME``,
   ``<SOMETHING>``, ``TODO-xyz``) instead of a real value because it lacked the
   grounding to write the concrete step.
2. **Invented references** — the model hard-coded a route or selector that the
   project's Knowledge Base does not know about, i.e. it guessed at application
   structure that may not exist.

The gate returns one of three outcomes:

- ``passed``   — no placeholders, no invented references. Safe to run.
- ``blocked``  — the spec needs something the KB genuinely lacks (a missing
                 screen/route/selector). This is a *missing-input* situation:
                 the fix is to build the thing and re-index, not to nag the model.
- ``rejected`` — the KB *does* contain routes/selectors, yet the model still
                 emitted a placeholder or invented value. The model misbehaved;
                 regeneration (with the grounding) should fix it.

The heuristic does not need to be perfect, but it MUST NOT flag a clean spec that
only uses known routes/selectors — no false positives.
"""

from __future__ import annotations

import re

# ---------------------------------------------------------------- patterns
# Placeholder tokens. Word patterns are case-insensitive; the angle-bracket
# patterns are deliberately conservative so they never match TSX/generics
# (e.g. ``<div>``, ``Array<string>``): only SHOUTING placeholders like
# ``<BASE_URL>`` / ``<USER NAME>`` and the literal ``<...>`` ellipsis.
PLACEHOLDER_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bTODO-\w+", re.IGNORECASE),  # before bare TODO so it wins the token
    re.compile(r"\bTODO\b", re.IGNORECASE),
    re.compile(r"\bFIXME\b", re.IGNORECASE),
    re.compile(r"\bPLACEHOLDER\b", re.IGNORECASE),
    re.compile(r"<[A-Z_][A-Z0-9_ ]*>"),  # <BASE_URL>, <USER NAME> — never <div>
    re.compile(r"<\.\.\.>"),  # explicit ellipsis placeholder
]

# Assertion fragments used to gauge how much a spec actually verifies. Counting
# these lets a later slice reject a "fix" that passes only by deleting assertions.
_ASSERTION_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\bexpect\("),
    re.compile(r"\.toHave"),
    re.compile(r"\.toBe"),
    re.compile(r"\.toContain"),
    re.compile(r"await\s+expect\b"),
]

# Route + selector extraction from spec source.
_GOTO_RE = re.compile(r"\.goto\(\s*[\"'`]([^\"'`]+)[\"'`]")
_LOCATOR_RE = re.compile(r"\.locator\(\s*[\"'`]([^\"'`]+)[\"'`]")
_TESTID_RE = re.compile(r"getByTestId\(\s*[\"'`]([^\"'`]+)[\"'`]")
# Hard-coded CSS id / [data-testid=...] selectors appearing as string literals.
_CSS_ID_RE = re.compile(r"[\"'`](#[A-Za-z][\w-]*)[\"'`]")
_DATA_TESTID_ATTR_RE = re.compile(r"[\"'`](\[data-testid=[^\"'`\]]+\])[\"'`]")

# ----------------------------------------------------------- flaky patterns
# Deterministic, cheap flaky/brittle-pattern checks (#181) — run BEFORE any AI
# review (automation-reviewer) so obviously bad specs never cost a Claude call.
_HARD_WAIT_RE = re.compile(r"\bwaitForTimeout\(")
# Brittle raw-CSS locators: a bare class selector, a descendant/child
# combinator, or an nth-child/nth-of-type index passed to `.locator(...)` —
# all DOM-structure-dependent and prone to breaking on any markup change.
# data-testid / id / attribute selectors are handled separately above and are
# NOT considered brittle here.
_BRITTLE_CSS_PATTERNS: list[re.Pattern[str]] = [
    re.compile(r"\.locator\(\s*[\"'`](\.[\w-]+(?:\s*[>\s][^\"'`]*)?)[\"'`]"),
    re.compile(r"\.locator\(\s*[\"'`]([^\"'`]*:nth-(?:child|of-type)\([^\"'`]*\)[^\"'`]*)[\"'`]"),
]


def count_assertions(code: str) -> int:
    """Count Playwright assertion occurrences in a spec's source.

    Sums matches of ``expect(``, ``await expect``, and the ``.toHave`` /
    ``.toBe`` / ``.toContain`` matcher fragments. This is a rough strength
    signal (not a parse), used later to reject assertion-weakening "fixes".

    Args:
        code: The spec's TypeScript source.

    Returns:
        The total number of assertion-related fragments found (>= 0).
    """
    if not code:
        return 0
    return sum(len(pat.findall(code)) for pat in _ASSERTION_PATTERNS)


def find_placeholders(code: str) -> list[str]:
    """Return the placeholder tokens present in a spec's source.

    Args:
        code: The spec's TypeScript source.

    Returns:
        The matched placeholder substrings (e.g. ``["TODO", "<BASE_URL>"]``),
        de-duplicated while preserving first-seen order. Empty when clean.
    """
    if not code:
        return []
    found: list[str] = []
    seen: set[str] = set()
    for pat in PLACEHOLDER_PATTERNS:
        for match in pat.findall(code):
            token = match if isinstance(match, str) else match[0]
            key = token.upper()
            if key not in seen:
                seen.add(key)
                found.append(token)
    return found


def find_flaky_patterns(code: str) -> list[str]:
    """Return deterministic flaky/brittle-pattern findings in a spec's source.

    Cheap, regex-based checks that run BEFORE any AI review (``automation-reviewer``):
    hard-coded waits (``page.waitForTimeout``), specs that assert nothing at all
    (reuses :func:`count_assertions`), and obviously brittle raw-CSS locators (bare
    class selectors, descendant/child combinators, ``:nth-child``/``:nth-of-type`` —
    all DOM-order dependent).

    Args:
        code: The spec's TypeScript source.

    Returns:
        Human-readable finding strings, de-duplicated. Empty when the spec is
        clean of these patterns.
    """
    if not code:
        return []
    findings: list[str] = []
    if _HARD_WAIT_RE.search(code):
        findings.append("hard-coded wait: page.waitForTimeout(...)")
    if count_assertions(code) == 0:
        findings.append("zero assertions — spec verifies nothing")
    seen: set[str] = set()
    for pat in _BRITTLE_CSS_PATTERNS:
        for match in pat.findall(code):
            value = match.strip()
            if value and value not in seen:
                seen.add(value)
                findings.append(f"brittle CSS locator: {value}")
    return findings


def _normalize_path(url: str) -> str:
    """Reduce a URL or path to its bare path for KB comparison.

    Strips scheme+host and any query/hash so ``http://x/app/login?next=1`` and
    ``/app/login`` compare equal. Returns "" for values that carry no path.
    """
    value = (url or "").strip()
    if not value:
        return ""
    # Drop scheme://host if present.
    match = re.match(r"^[a-zA-Z][\w+.-]*://[^/]*(/.*)?$", value)
    if match:
        value = match.group(1) or "/"
    # Drop query/hash.
    value = value.split("?", 1)[0].split("#", 1)[0]
    return value.rstrip("/") or "/"


def _known_route_paths(known: dict) -> set[str]:
    """Normalized set of route paths the KB knows about."""
    out: set[str] = set()
    for route in known.get("routes") or []:
        path = route if isinstance(route, str) else (route.get("path", "") if isinstance(route, dict) else "")
        norm = _normalize_path(path)
        if norm:
            out.add(norm)
    return out


# A `${...}` template-literal interpolation inside a goto() target.
_INTERP_RE = re.compile(r"\$\{[^}]*\}")


def _path_segments(path: str) -> list[str]:
    """Split a normalized path into its non-empty segments."""
    return [seg for seg in path.strip("/").split("/") if seg]


def _route_goto_is_grounded(raw: str, base_url: str, known_routes: set[str]) -> bool:
    """Whether a goto() target corresponds to a known KB route.

    Handles both plain string paths and template literals that interpolate
    grounded constants, e.g. ``\\`${BASE_URL}/employers/${EMPLOYER_ID}/groups/${GROUP_ID}\\```.
    A leading ``${...}`` (the base-URL variable) or literal ``base_url`` prefix is
    stripped, then each ``${...}`` path segment is treated as a wildcard and matched
    against the KB routes segment-by-segment: a legitimately *parameterized* real
    route is grounded, while a made-up *static* segment (e.g. ``/made-up-screen``)
    still fails to match. A path whose segments are all interpolations carries no
    static structure to verify, so it is treated as grounded (no false positives).

    Args:
        raw: The raw goto() argument as captured from source (quotes/backticks
            already stripped by the caller's regex).
        base_url: The KB base URL, stripped from the front when present as a literal.
        known_routes: Normalized KB route paths to match against.

    Returns:
        True when the target is (or matches) a known route, False when it looks
        invented.
    """
    value = raw.strip()
    # Drop a leading ${...} interpolation (the base-URL variable) or a literal
    # base_url prefix, so only the route path remains for comparison.
    lead = re.match(r"^\s*\$\{[^}]*\}", value)
    if lead:
        value = value[lead.end():]
    elif base_url and value.startswith(base_url):
        value = value[len(base_url):]

    if "${" not in value:
        # Plain literal path — exact match against the KB (the empty/"/" defaults
        # are handled as safe by the caller).
        return _normalize_path(value) in known_routes

    spec_segs = _path_segments(_normalize_path(value))
    if not any("${" not in seg for seg in spec_segs):
        # No static segment to verify — cannot be confidently called invented.
        return True
    for route in known_routes:
        route_segs = _path_segments(route)
        if len(route_segs) != len(spec_segs):
            continue
        if all("${" in s or s == r for s, r in zip(spec_segs, route_segs)):
            return True
    return False


def _known_selectors(known: dict) -> set[str]:
    """Set of selector strings the KB knows about (whitespace-trimmed)."""
    out: set[str] = set()
    for sel in known.get("selectors") or []:
        value = sel if isinstance(sel, str) else (sel.get("selector", "") if isinstance(sel, dict) else "")
        value = (value or "").strip()
        if value:
            out.add(value)
    return out


def _find_invented(code: str, known: dict) -> list[str]:
    """Collect routes/selectors used by the spec that the KB does not know.

    A goto() target is "invented" when its path is absent from the KB routes.
    A hard-coded selector (``.locator("...")``, ``getByTestId(...)``, ``#id``,
    ``[data-testid=...]``) is "invented" when it is absent from the KB selectors.
    Comparison is defensive: with no known routes/selectors at all nothing is
    flagged as invented here (that empty-KB case is handled by the caller as a
    BLOCKED missing-input, not a rejection).
    """
    invented: list[str] = []
    seen: set[str] = set()

    known_routes = _known_route_paths(known)
    if known_routes:
        base_url = (known.get("base_url") or "").strip()
        for raw in _GOTO_RE.findall(code):
            path = _normalize_path(raw)
            # Ignore relative-to-baseURL "" and pure "/" — those are safe defaults.
            if not path or path == "/" or raw in seen:
                continue
            # Template-literal targets (`${BASE_URL}/employers/${ID}`) are matched by
            # pattern, not string equality — grounded, parameterized routes must not
            # be mistaken for invented ones (#gate false positive).
            if not _route_goto_is_grounded(raw, base_url, known_routes):
                seen.add(raw)
                invented.append(f"route {raw}")

    known_selectors = _known_selectors(known)
    if known_selectors:
        selector_hits: list[str] = []
        selector_hits += _LOCATOR_RE.findall(code)
        selector_hits += _TESTID_RE.findall(code)
        selector_hits += _CSS_ID_RE.findall(code)
        selector_hits += _DATA_TESTID_ATTR_RE.findall(code)
        for sel in selector_hits:
            value = (sel or "").strip()
            if value and value not in known_selectors and value not in seen:
                seen.add(value)
                invented.append(f"selector {value}")

    return invented


def gate_spec(code: str, known: dict) -> dict:
    """Gate a generated spec against placeholders and invented references.

    Args:
        code: The generated Playwright/TypeScript spec source.
        known: A normalized Knowledge-Base view shaped::

                {
                    "routes": list[str],     # or list[{"path": str, ...}]
                    "selectors": list[str],  # or list[{"selector": str, ...}]
                    "base_url": str,
                }

            Both list-of-string and list-of-dict forms are accepted so callers
            can pass the raw KB ``routes``/``selectors`` shape directly.

    Returns:
        A dict::

            {
                "outcome": "passed" | "blocked" | "rejected",
                "findings": list[str],   # the offending tokens/refs
                "reason": str,           # human-readable explanation
                "unblock_action": str,   # what to do next ("" when passed)
            }

        Decision logic:

        - No placeholders and no invented refs -> ``passed``.
        - Otherwise, ``blocked`` when the KB genuinely lacks grounding for what
          the spec needs (no known routes AND no known selectors — a
          missing-input situation), with a concrete ``reason`` + ``unblock_action``.
        - ``rejected`` when the KB *does* contain routes/selectors yet the model
          still emitted a placeholder or invented value (the model should have
          used the grounding it was given).

    A clean spec that only uses known routes/selectors always returns ``passed``.

    Deterministic flaky-pattern findings (hard waits, zero assertions, brittle raw
    CSS — see :func:`find_flaky_patterns`) win first: they are genuine code-quality
    defects the model should fix, not a missing-KB-input situation, so they always
    reject regardless of what grounding the KB provides.
    """
    known = known or {}
    flaky = find_flaky_patterns(code or "")
    if flaky:
        detail = ", ".join(flaky[:6])
        return {
            "outcome": "rejected",
            "findings": flaky,
            "reason": f"The spec contains flaky/brittle patterns ({detail}).",
            "unblock_action": (
                "Regenerate using web-first assertions (with at least one "
                "assertion) instead of hard waits, and prefer KB-known "
                "data-testid/role locators over brittle raw CSS."
            ),
        }

    placeholders = find_placeholders(code or "")
    invented = _find_invented(code or "", known)
    findings = placeholders + invented

    if not findings:
        return {
            "outcome": "passed",
            "findings": [],
            "reason": "No placeholders or invented references found.",
            "unblock_action": "",
        }

    has_grounding = bool(_known_route_paths(known)) or bool(_known_selectors(known))

    if not has_grounding:
        # The KB has nothing to ground against — treat as a missing-input block
        # rather than blaming the model. Name what is missing.
        missing = ", ".join(findings[:6]) or "the referenced screen/route/selector"
        return {
            "outcome": "blocked",
            "findings": findings,
            "reason": (
                "The spec references application structure the Knowledge Base does "
                f"not know about ({missing}). No indexed routes or selectors are "
                "available to ground it."
            ),
            "unblock_action": (
                "Implement the required screen/route, then re-run project-bootstrap "
                "to index the new routes/selectors and regenerate."
            ),
        }

    # The KB has grounding, yet the spec still carries placeholders/inventions —
    # the model failed to use what it was given.
    detail = ", ".join(findings[:6])
    return {
        "outcome": "rejected",
        "findings": findings,
        "reason": (
            "The spec contains placeholders or invented references "
            f"({detail}) despite the Knowledge Base providing grounded "
            "routes/selectors to use."
        ),
        "unblock_action": (
            "Regenerate the spec using the known routes/selectors from the "
            "Knowledge Base instead of placeholders or guessed values."
        ),
    }
