"""Real Playwright execution — invokes `npx playwright test` as a subprocess.

Per ADR 0001 there is no simulated fallback: the runner genuinely spawns
Playwright against the generated `*.spec.ts` files for a run and parses its
JSON reporter output. Failures (missing binary, non-zero exit with no report,
timeout) are surfaced via WS + ExecutionResult/Execution status rather than
faked.

The parsing step is a pure function, ``parse_playwright_report``, so tests can
exercise the mapping from a Playwright JSON report to per-spec results without
spawning a real browser.

Playwright invocation choice: we run `npx playwright test` with **cwd = the
run's spec directory** (`settings.specs_dir/{run.code}`), not the frontend
`app/` dir. The frontend has no Playwright installation or config of its own
(checked: no `playwright.config.*` in `app/`, `@playwright/test` isn't a
frontend dependency), so anchoring execution there would require it to own a
browser-testing setup it doesn't have. Instead we write a minimal
`playwright.config.ts` into the run's spec dir (if one doesn't already exist)
and run `npx playwright test` there; npx resolves `@playwright/test` from
whichever npm-managed location has it installed/cached on the machine. This
keeps the specs, config, and captured artifacts self-contained per run.
"""

from __future__ import annotations

import json
import subprocess
import time
from pathlib import Path
from typing import Any

from app import db as db_module
from app.config import settings
from app.logging import logger
from app.models.execution import Evidence, Execution, ExecutionResult
from app.models.run import Run
from app.ws import hub

_PLAYWRIGHT_CONFIG_TEMPLATE = """\
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  timeout: 30000,
  workers: __WORKERS__,
  reporter: [['json', { outputFile: 'report.json' }]],
  use: {
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure',
  },
});
"""

_STATUS_MAP = {
    "passed": "pass",
    "failed": "fail",
    "timedOut": "fail",
    "interrupted": "fail",
    "skipped": "skipped",
}

# Evidence.kind values a Playwright attachment `name` can map to.
_ATTACHMENT_KIND_MAP = {
    "screenshot": "screenshot",
    "video": "video",
    "trace": "trace",
}


def _ensure_config(spec_dir: Path, workers: int) -> None:
    """Write playwright.config.ts into the spec dir if one doesn't exist yet."""
    config_path = spec_dir / "playwright.config.ts"
    if not config_path.exists():
        content = _PLAYWRIGHT_CONFIG_TEMPLATE.replace("__WORKERS__", str(workers))
        config_path.write_text(content, encoding="utf-8")


def parse_playwright_report(report: dict[str, Any]) -> list[dict[str, Any]]:
    """Map a Playwright JSON-reporter report to per-spec result dicts.

    Args:
        report: The parsed contents of Playwright's `--reporter=json` output
            (top-level keys include ``suites``).

    Returns:
        A list of dicts, one per test spec, each shaped as::

            {
                "file": str,               # spec file name, e.g. "1428-TC-01.spec.ts"
                "title": str,               # test title
                "status": "pass"|"fail"|"skipped",
                "duration_ms": int,
                "error_message": str,
                "attachments": [{"kind": str, "path": str}, ...],
            }

        Nested suites (Playwright groups specs per file, and can nest describe
        blocks) are flattened. If a test was retried, the **last** result is
        used to determine final status/duration/error, matching what the
        Playwright UI reports as the outcome.
    """
    out: list[dict[str, Any]] = []

    def walk(suite: dict[str, Any], file_hint: str) -> None:
        file_name = suite.get("file") or file_hint
        for spec in suite.get("specs", []) or []:
            spec_file = spec.get("file") or file_name
            for test in spec.get("tests", []) or []:
                results = test.get("results", []) or []
                last = results[-1] if results else {}
                status = _STATUS_MAP.get(last.get("status", ""), "fail")
                error = last.get("error", {}) or {}
                error_message = error.get("message", "") if isinstance(error, dict) else str(error)
                attachments = [
                    {"kind": _ATTACHMENT_KIND_MAP.get(a.get("name", ""), a.get("name", "")), "path": a.get("path", "")}
                    for a in last.get("attachments", []) or []
                    if a.get("name") in _ATTACHMENT_KIND_MAP and a.get("path")
                ]
                out.append(
                    {
                        "file": spec_file,
                        "title": spec.get("title", ""),
                        "status": status,
                        "duration_ms": int(last.get("duration", 0) or 0),
                        "error_message": error_message,
                        "attachments": attachments,
                    }
                )
        for child in suite.get("suites", []) or []:
            walk(child, file_name)

    for top_suite in report.get("suites", []) or []:
        walk(top_suite, top_suite.get("file", ""))

    return out


def _invoke_playwright(spec_dir: Path, workers: int, timeout_s: int) -> tuple[int, str, str]:
    """Run `npx playwright test` in spec_dir. Returns (returncode, stdout, stderr)."""
    cmd = [settings.playwright_bin, "playwright", "test", f"--workers={workers}"]
    logger.info("Playwright: {} (cwd={})", " ".join(cmd), spec_dir)
    proc = subprocess.run(  # noqa: S603
        cmd,
        cwd=str(spec_dir),
        capture_output=True,
        text=True,
        timeout=timeout_s,
        shell=True,  # noqa: S602 - npx.cmd resolution on Windows
    )
    return proc.returncode, proc.stdout, proc.stderr


def _match_result(
    db_results: list[ExecutionResult], parsed: dict[str, Any]
) -> ExecutionResult | None:
    """Find the ExecutionResult row whose spec filename matches a parsed entry."""
    file_name = Path(parsed["file"]).name
    for result in db_results:
        expected = f"{result.ticket_external_id.rsplit('-', 1)[-1]}-{result.case_code}.spec.ts"
        if expected == file_name:
            return result
    return None


def _store_evidence(db, run: Run, result: ExecutionResult, attachments: list[dict]) -> None:
    """Copy/record evidence artifacts for a result under settings.evidence_dir."""
    import shutil

    dest_dir = settings.evidence_dir / run.code / result.ticket_external_id / result.case_code
    dest_dir.mkdir(parents=True, exist_ok=True)
    for att in attachments:
        src = Path(att["path"])
        if not src.exists():
            continue
        dest = dest_dir / src.name
        try:
            shutil.copy2(src, dest)
        except OSError as exc:
            logger.warning("Failed to copy evidence {}: {}", src, exc)
            continue
        rel_path = dest.relative_to(settings.evidence_dir).as_posix()
        evidence = Evidence(
            result_id=result.id,
            kind=att["kind"],
            path=rel_path,
            filename=dest.name,
            size_bytes=dest.stat().st_size,
        )
        db.add(evidence)


def run_execution(execution_id: int) -> None:
    """Background worker: run Playwright for an Execution and record results.

    Uses its own SessionLocal() session since this runs in a background thread.
    Publishes WS events: exec.case.running, exec.case.result, exec.progress,
    exec.done. Advances Run.status to 'evidence' when finished.
    """
    db = db_module.SessionLocal()
    try:
        execution = db.get(Execution, execution_id)
        if execution is None:
            return
        run = db.get(Run, execution.run_id)
        if run is None:
            return

        results = (
            db.query(ExecutionResult)
            .filter(ExecutionResult.execution_id == execution_id)
            .order_by(ExecutionResult.id)
            .all()
        )
        total = len(results)
        run_id_str = str(run.id)

        for index, result in enumerate(results, start=1):
            result.status = "running"
            db.commit()
            hub.publish(
                run_id_str,
                "exec.case.running",
                {
                    "ticket": result.ticket_external_id,
                    "caseCode": result.case_code,
                    "index": index,
                    "total": total,
                },
            )

        spec_dir = settings.specs_dir / run.code
        spec_dir.mkdir(parents=True, exist_ok=True)
        _ensure_config(spec_dir, execution.workers)

        report: dict[str, Any] = {}
        run_error: str | None = None
        started = time.monotonic()
        try:
            _invoke_playwright(spec_dir, execution.workers, settings.exec_timeout_s)
        except FileNotFoundError as exc:
            run_error = f"Playwright binary not found ('{settings.playwright_bin}'): {exc}"
        except subprocess.TimeoutExpired:
            run_error = f"Playwright run timed out after {settings.exec_timeout_s}s"
        finally:
            elapsed_ms = int((time.monotonic() - started) * 1000)

        report_path = spec_dir / "report.json"
        if run_error is None:
            if report_path.exists():
                try:
                    report = json.loads(report_path.read_text(encoding="utf-8"))
                except json.JSONDecodeError as exc:
                    run_error = f"Could not parse Playwright report: {exc}"
            else:
                run_error = "Playwright produced no report.json"

        parsed = parse_playwright_report(report) if report else []

        passed = failed = 0
        matched_ids: set[int] = set()
        for entry in parsed:
            result = _match_result(results, entry)
            if result is None:
                continue
            matched_ids.add(result.id)
            result.status = entry["status"]
            result.duration_ms = entry["duration_ms"] or elapsed_ms
            result.error_message = entry["error_message"]
            if result.status == "pass":
                passed += 1
            elif result.status == "fail":
                failed += 1
            db.commit()
            _store_evidence(db, run, result, entry["attachments"])
            db.commit()
            hub.publish(
                run_id_str,
                "exec.case.result",
                {
                    "ticket": result.ticket_external_id,
                    "caseCode": result.case_code,
                    "status": result.status,
                    "durationMs": result.duration_ms,
                },
            )
            progress = int(100 * len(matched_ids) / total) if total else 100
            execution.progress = progress
            execution.passed = passed
            execution.failed = failed
            db.commit()
            hub.publish(
                run_id_str,
                "exec.progress",
                {"progress": progress, "passed": passed, "failed": failed, "remaining": total - len(matched_ids)},
            )

        # Any result Playwright didn't report on (e.g. run_error) is marked failed.
        for result in results:
            if result.id in matched_ids:
                continue
            result.status = "fail"
            result.error_message = run_error or "No result reported by Playwright"
            result.duration_ms = elapsed_ms
            failed += 1
            db.commit()
            hub.publish(
                run_id_str,
                "exec.case.result",
                {
                    "ticket": result.ticket_external_id,
                    "caseCode": result.case_code,
                    "status": result.status,
                    "durationMs": result.duration_ms,
                },
            )

        execution.passed = passed
        execution.failed = failed
        execution.total = total
        execution.progress = 100
        execution.status = "done"
        from datetime import datetime, timezone

        execution.finished_at = datetime.now(timezone.utc)
        run.status = "evidence"
        db.commit()

        hub.publish(run_id_str, "exec.progress", {"progress": 100, "passed": passed, "failed": failed, "remaining": 0})
        hub.publish(run_id_str, "exec.done", {"passed": passed, "failed": failed})
        hub.publish(run_id_str, "run.status", {"status": run.status})
    finally:
        db.close()
