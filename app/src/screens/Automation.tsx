import { AlertTriangle, Check, ChevronDown, ChevronRight, Download, FileCode, GitBranch, Pencil, Play, RotateCcw, Save, Sparkles, Wand2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Dropdown";
import { GlassCard } from "@/components/ui/GlassCard";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  useAutomationStatus,
  useExecution,
  useGenerateAutomation,
  useHealReport,
  useHealSpec,
  useHealStatus,
  useRegenerateSpec,
  useRun,
  useRunCases,
  useRunRepos,
  useRunSpec,
  useSetRunTicketRepo,
  useSpecs,
  useStartExecution,
  useTickets,
  useUpdateSpec,
} from "@/hooks/queries";
import { useRunEvents } from "@/hooks/useRunEvents";
import { queryKeys } from "@/lib/queryKeys";
import type { HealAttempt, HealReport, ProgressEvent } from "@/types/api";

const THINKING_STEPS = [
  "Reading approved test cases",
  "Mapping steps to Playwright locators",
  "Writing assertions",
  "Formatting TypeScript specs",
];

export function Automation() {
  const runId = Number(useParams().runId);
  const navigate = useNavigate();
  const { data: run } = useRun(runId);
  const { data: specs, isLoading } = useSpecs(runId);
  const { data: cases } = useRunCases(runId);
  const generateAutomation = useGenerateAutomation(runId);
  const regenerateSpec = useRegenerateSpec(runId);
  const updateSpec = useUpdateSpec(runId);
  const startExecution = useStartExecution(runId);
  const { data: autoStatus } = useAutomationStatus(runId);
  const { data: repoOptions } = useRunRepos(runId);
  const { data: tickets } = useTickets();
  const { data: execution } = useExecution(runId);
  const setTicketRepo = useSetRunTicketRepo(runId);
  const healSpec = useHealSpec(runId);
  const runSpec = useRunSpec(runId);
  const qc = useQueryClient();

  // Which spec is selected — a deep-linkable selection in the URL (`?case=`).
  const [searchParams, setSearchParams] = useSearchParams();
  const caseParam = searchParams.get("case");
  const selectedSpecCaseId = caseParam != null ? Number(caseParam) : null;
  const selectSpec = useCallback(
    (caseId: number, replace = false) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("case", String(caseId));
          return next;
        },
        { replace },
      ),
    [setSearchParams],
  );

  const [copyLabel, setCopyLabel] = useState("Copy");
  const [thinkStep, setThinkStep] = useState(0);
  // Latest automation.progress detail for the banner. Captured from the WS
  // stream (see onRunEvent); cleared when generation finishes.
  const [genProgress, setGenProgress] = useState<{
    done: number;
    total: number;
    file: string;
    message: string;
  } | null>(null);
  // Generation runs in the background on the server; the POST returns
  // immediately. Derive the running state from the persisted server status so it
  // survives navigation and blocks re-triggering.
  const generating = (autoStatus?.generating ?? false) || generateAutomation.isPending;

  // Live self-heal progress (from the WS stream). Cleared shortly after a
  // terminal phase (passed/failed).
  const [healProgress, setHealProgress] = useState<{
    caseId: number;
    ticket: string;
    caseCode: string;
    attempt: number;
    maxAttempts: number;
    phase: "running" | "fixing" | "passed" | "failed";
    message: string;
    error: string;
  } | null>(null);

  const specCount = specs ? specs.length : 0;

  // The run's automatable cases (approved + not Manual) — what generation targets.
  const automatableCount = useMemo(
    () => (cases ?? []).filter((c) => c.approval === "approved" && c.automation !== "Manual").length,
    [cases],
  );

  // Approved cases still missing a spec — the target of incremental generation.
  const missingCount = Math.max(0, automatableCount - specCount);

  // Latest execution status per case, for the status dot next to each spec.
  const resultStatusByCase = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of execution?.results ?? []) map.set(r.testCaseId, r.status);
    return map;
  }, [execution]);

  // Per-work-item target repositories. Options come from the run's project repos;
  // each work item defaults to the repo Claude guessed (its `repo`), falling back
  // to the project default repo when unset.
  const runTickets = run?.runTickets ?? [];
  const repoSelectOptions = useMemo(
    () => (repoOptions ?? []).map((r) => ({ value: r.name, label: r.name })),
    [repoOptions],
  );
  const defaultRepoName = useMemo(
    () => repoOptions?.find((r) => r.default)?.name ?? repoOptions?.[0]?.name ?? "",
    [repoOptions],
  );
  const repoStatusOf = useCallback(
    (name: string) => repoOptions?.find((r) => r.name === name)?.status,
    [repoOptions],
  );
  const showRepoPanel = runTickets.length > 0 && (repoOptions?.length ?? 0) > 0;

  // Capture live progress for the banner, surface per-spec generation errors,
  // and clear progress when the background pass finishes (run.status flips once
  // every case has been attempted).
  const onRunEvent = useCallback((evt: ProgressEvent) => {
    if (evt.event === "run.status") {
      setGenProgress(null);
      return;
    }
    if (evt.event === "automation.progress") {
      const p = evt.payload as {
        message?: string;
        file?: string;
        error?: string;
        done?: number;
        total?: number;
      };
      const message = p.error || p.message || "";
      setGenProgress({
        done: typeof p.done === "number" ? p.done : 0,
        total: typeof p.total === "number" ? p.total : 0,
        file: p.file ?? "",
        message,
      });
      if (message.toLowerCase().startsWith("error")) {
        toast.error(`${p.file ?? "spec"}: ${message}`);
      }
      return;
    }
    if (evt.event === "heal.progress") {
      const p = evt.payload as {
        caseId: number;
        ticket: string;
        caseCode: string;
        attempt: number;
        maxAttempts: number;
        phase: "running" | "fixing" | "passed" | "failed";
        message: string;
        error?: string;
      };
      setHealProgress({ ...p, error: p.error ?? "" });
      if (p.phase === "passed" || p.phase === "failed") {
        if (p.phase === "passed") toast.success(`Self-heal fixed ${p.caseCode}`);
        else toast.error(`Self-heal gave up on ${p.caseCode}: ${p.message || "still failing"}`);
        // The spec code, latest execution result, and heal trail changed on the server.
        qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
        qc.invalidateQueries({ queryKey: queryKeys.execution(runId) });
        qc.invalidateQueries({ queryKey: queryKeys.healStatus(p.caseId) });
        qc.invalidateQueries({ queryKey: queryKeys.healReport(p.caseId) });
        setTimeout(() => setHealProgress(null), 4000);
      }
    }
  }, [qc, runId]);
  useRunEvents(onRunEvent);

  // Belt-and-braces: clear the banner detail whenever generation is no longer
  // active (covers the case where the run.status event is missed).
  useEffect(() => {
    if (!generating) setGenProgress(null);
  }, [generating]);

  // Incremental generation: only cases that don't yet have a spec. Newly
  // approved cases get specs while already-generated (and possibly edited) ones
  // are left untouched.
  const startGenerate = () => {
    generateAutomation.mutate(false, {
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Automation generation failed to start"),
    });
  };

  // Force regeneration of every approved case, overwriting existing specs
  // (including manual edits). Guarded by a confirm since it is destructive.
  const regenerateAll = () => {
    if (
      !window.confirm(
        "Regenerate every spec? This overwrites all generated specs, including any manual edits.",
      )
    )
      return;
    generateAutomation.mutate(true, {
      onError: (e) =>
        toast.error(e instanceof Error ? e.message : "Automation generation failed to start"),
    });
  };

  // Kick off a real execution for the active run, then land on the Execution
  // screen where progress is streamed. Navigating alone would leave it idle.
  const startExecutionAndView = () => {
    startExecution.mutate(
      {},
      {
        onSuccess: () => navigate("/runs/" + runId + "/execution"),
        onError: (e) =>
          toast.error(e instanceof Error ? e.message : "Failed to start execution"),
      },
    );
  };

  const thinking = specCount === 0 && (generating || (isLoading && specCount === 0));

  useEffect(() => {
    if (!thinking) {
      setThinkStep(0);
      return;
    }
    const id = setInterval(() => {
      setThinkStep((n) => Math.min(n + 1, THINKING_STEPS.length - 1));
    }, 1100);
    return () => clearInterval(id);
  }, [thinking]);

  // Default to the first spec once the list loads.
  useEffect(() => {
    if (specs && specs.length && selectedSpecCaseId == null) {
      selectSpec(specs[0].testCaseId, true);
    }
  }, [specs, selectedSpecCaseId, selectSpec]);

  const selectedSpec = useMemo(
    () => specs?.find((s) => s.testCaseId === selectedSpecCaseId) ?? specs?.[0] ?? null,
    [specs, selectedSpecCaseId],
  );

  // Code-folding state for the read-only spec viewer. Fold ranges are derived
  // from the selected spec's code; `folded` holds the opener line indices that
  // are currently collapsed. Reset whenever the selected spec changes so folds
  // never carry over between files.
  const foldRanges = useMemo(
    () => (selectedSpec ? computeFoldRanges(selectedSpec.code) : []),
    [selectedSpec],
  );
  const [folded, setFolded] = useState<Set<number>>(new Set());
  useEffect(() => {
    setFolded(new Set());
  }, [selectedSpec?.testCaseId, selectedSpec?.filename]);
  const toggleFold = useCallback((start: number) => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }, []);
  const collapseAll = useCallback(() => {
    setFolded(new Set(foldRanges.map((r) => r.start)));
  }, [foldRanges]);
  const expandAll = useCallback(() => setFolded(new Set()), []);

  // Inline edit state for the selected spec. `draft` holds the textarea contents
  // while editing. Reset (exit edit mode) whenever the selected spec changes, so
  // an in-progress edit never bleeds into a different file.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  useEffect(() => {
    setEditing(false);
  }, [selectedSpec?.testCaseId, selectedSpec?.filename]);

  // True while this spec's per-file regenerate mutation is in flight.
  const specRegenerating = regenerateSpec.isPending;

  // Self-heal state for the selected spec. Poll the server so "Healing…"
  // survives navigating away/back; OR it with the mutation's pending flag and
  // the live WS phase for instant feedback.
  const selectedCaseId = selectedSpec?.testCaseId ?? 0;
  const { data: healStatusData } = useHealStatus(selectedCaseId, !!selectedCaseId);
  const liveHealingThisCase =
    healProgress?.caseId === selectedCaseId &&
    healProgress?.phase !== "passed" &&
    healProgress?.phase !== "failed";
  const healingThisCase =
    healSpec.isPending || !!liveHealingThisCase || (healStatusData?.healing ?? false);

  // "Run" stays in its loading state for the whole background execution, not
  // just the POST: true while the mutation is in flight, or while the latest
  // execution is still running this spec's case (pending/running result).
  const selectedResult = execution?.results.find((r) => r.testCaseId === selectedCaseId);
  const runningThisSpec =
    runSpec.isPending ||
    (execution?.status === "running" &&
      (selectedResult?.status === "running" || selectedResult?.status === "pending"));

  // The last self-heal trail for the selected spec (per-attempt error + diff).
  const { data: healReportRaw } = useHealReport(selectedCaseId, !!selectedCaseId);
  const healReport =
    healReportRaw && "attempts" in healReportRaw && healReportRaw.attempts?.length
      ? (healReportRaw as HealReport)
      : null;

  const handleCopy = () => {
    if (!selectedSpec) return;
    navigator.clipboard.writeText(selectedSpec.code);
    setCopyLabel("Copied!");
    toast.success("Code copied to clipboard");
    setTimeout(() => setCopyLabel("Copy"), 1500);
  };

  const handleDownload = () => {
    if (!selectedSpec) return;
    const blob = new Blob([selectedSpec.code], { type: "text/typescript" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = selectedSpec.filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const startEdit = () => {
    if (!selectedSpec) return;
    setDraft(selectedSpec.code);
    setEditing(true);
  };

  // Kick off the self-heal loop for the selected spec: run it, and while it
  // fails feed the error back to Claude to regenerate + re-run, until it passes
  // or hits the attempts cap. Progress streams over WS (see onRunEvent).
  const startHeal = () => {
    if (!selectedSpec) return;
    healSpec.mutate(selectedSpec.testCaseId, {
      onSuccess: () =>
        qc.invalidateQueries({ queryKey: queryKeys.healStatus(selectedSpec.testCaseId) }),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to start self-heal"),
    });
  };

  // Run just this one spec (not the whole suite). Status dots refresh via the
  // execution query invalidation in useRunSpec.
  const runThisSpec = () => {
    if (!selectedSpec) return;
    const file = selectedSpec.filename;
    runSpec.mutate(selectedSpec.testCaseId, {
      onSuccess: () => toast.success(`Running ${file}…`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to run test"),
    });
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = () => {
    if (!selectedSpec) return;
    updateSpec.mutate(
      { caseId: selectedSpec.testCaseId, code: draft },
      {
        onSuccess: () => {
          setEditing(false);
          toast.success("Spec saved");
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to save spec"),
      },
    );
  };

  return (
    <div className="animate-fade-in-up px-1 pb-10 pt-0.5">
      <div className="mb-3.5 flex items-end justify-between">
        <div>
          <div className="mb-1 text-[13px] font-medium text-muted">
            {run?.code} &middot; Playwright · TypeScript · approved cases only
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Automation</h1>
        </div>
        {specCount > 0 && (
          <div className="flex items-center gap-2">
            {missingCount > 0 && (
              <Button variant="primary" onClick={startGenerate} disabled={generating}>
                <Sparkles size={15} strokeWidth={2.2} /> Generate new ({missingCount})
              </Button>
            )}
            <Button variant="glass" onClick={regenerateAll} disabled={generating}>
              <RotateCcw size={15} strokeWidth={2.2} /> Regenerate all
            </Button>
          </div>
        )}
      </div>
      <div className="mb-4">
        <PipelineRail stage={6} />
      </div>

      {showRepoPanel && (
        <GlassCard className="mb-3.5 p-4">
          <div className="mb-1 flex items-center gap-2">
            <GitBranch size={15} className="text-violet" />
            <span className="text-[13.5px] font-bold">Target repositories</span>
          </div>
          <p className="m-0 mb-3 text-xs leading-relaxed text-muted">
            Automation reads each work item's repository knowledge base. Claude guessed a default —
            override per item if needed.
          </p>
          <div className="flex flex-col gap-2">
            {runTickets.map((rt) => {
              const title = tickets?.find((t) => t.externalId === rt.ticketExternalId)?.title ?? "";
              const selected = rt.repo || defaultRepoName;
              const status = repoStatusOf(selected);
              return (
                <div
                  key={rt.ticketExternalId}
                  className="flex items-center gap-3 rounded-[11px] border border-white/[0.07] bg-white/[0.03] px-3 py-2"
                >
                  <span className="shrink-0 font-mono text-[12px] font-semibold text-violet">
                    {rt.ticketExternalId}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{title}</span>
                  {status && status !== "indexed" && (
                    <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-warning-soft">
                      <AlertTriangle size={12} />
                      knowledge not built
                    </span>
                  )}
                  <Select
                    value={selected}
                    options={repoSelectOptions}
                    placeholder="Select repo"
                    allowClear={false}
                    onChange={(v) => {
                      if (!v || v === selected) return;
                      setTicketRepo.mutate(
                        { tid: rt.ticketExternalId, repo: v },
                        {
                          onError: (e) =>
                            toast.error(e instanceof Error ? e.message : "Failed to set repository"),
                        },
                      );
                    }}
                  />
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {thinking && (
        <GlassCard className="p-[26px]" style={{ borderColor: "rgba(139,92,246,.28)" }}>
          <div className="mb-[22px] flex items-center gap-[13px]">
            <div
              className="flex h-11 w-11 items-center justify-center rounded-[14px]"
              style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", boxShadow: "0 0 26px rgba(139,92,246,.6)" }}
            >
              <Sparkles size={22} color="#fff" />
            </div>
            <div>
              <div className="text-[15px] font-bold">Writing Playwright automation</div>
              <div className="mt-0.5 text-xs text-muted">for every approved case in {run?.code}</div>
            </div>
          </div>
          <div className="flex flex-col gap-[13px]">
            {THINKING_STEPS.map((text, i) => {
              const done = i < thinkStep;
              const active = i === thinkStep;
              if (!done && !active) return null;
              return (
                <div key={text} className="flex items-center gap-3 text-[13.5px]">
                  {done ? (
                    <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-success">
                      <Check size={12} color="#fff" strokeWidth={3} />
                    </span>
                  ) : (
                    <span
                      className="h-[19px] w-[19px] shrink-0 rounded-full border-2"
                      style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
                    />
                  )}
                  <span className={done ? "text-muted" : "font-semibold text-ink"}>{text}</span>
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {generating && !thinking && (
        <GlassCard className="mb-3.5 flex items-center gap-3 p-4" style={{ borderColor: "rgba(139,92,246,.28)" }}>
          <span
            className="h-[18px] w-[18px] shrink-0 rounded-full border-2"
            style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
          />
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold">
              Generating automation…
              {genProgress && genProgress.total > 0 ? ` ${genProgress.done}/${genProgress.total}` : ""}
            </div>
            {genProgress && (genProgress.file || genProgress.message) && (
              <div className="mt-0.5 truncate text-xs text-muted">
                {genProgress.file ? <span className="font-mono">{genProgress.file}</span> : null}
                {genProgress.file && genProgress.message ? " · " : ""}
                {genProgress.message}
              </div>
            )}
          </div>
        </GlassCard>
      )}

      {healProgress && healProgress.phase !== "passed" && healProgress.phase !== "failed" && (
        <GlassCard className="mb-3.5 flex items-center gap-3 p-4" style={{ borderColor: "rgba(16,185,129,.32)" }}>
          <span
            className="h-[18px] w-[18px] shrink-0 rounded-full border-2"
            style={{ borderColor: "rgba(52,211,153,.35)", borderTopColor: "#34d399", animation: "spin .8s linear infinite" }}
          />
          <div className="min-w-0">
            <div className="text-[13.5px] font-bold">
              Self-healing {healProgress.caseCode} — attempt {healProgress.attempt}/{healProgress.maxAttempts}
            </div>
            <div className="mt-0.5 truncate text-xs text-muted">
              {healProgress.phase === "fixing"
                ? `Fixing with Claude — ${healProgress.error || "addressing the failure"}`
                : "Running the spec…"}
            </div>
          </div>
        </GlassCard>
      )}

      {!thinking && specs && specs.length === 0 && (
        <div className="glass flex flex-col items-center rounded-[22px] px-8 py-14 text-center">
          <div
            className="mb-5 flex h-[70px] w-[70px] items-center justify-center rounded-[22px]"
            style={{ background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))" }}
          >
            <FileCode size={30} color="#a78bfa" strokeWidth={1.9} />
          </div>
          <h2 className="m-0 mb-2 text-xl font-extrabold">No automation yet</h2>
          {automatableCount > 0 ? (
            <>
              <p className="m-0 mb-[22px] max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
                {automatableCount} approved case{automatableCount === 1 ? "" : "s"} ready to automate.
                Generate Playwright specs from them.
              </p>
              <Button variant="primary" size="lg" onClick={startGenerate} disabled={generating}>
                <Sparkles size={16} strokeWidth={2.2} /> Generate automation
              </Button>
            </>
          ) : (
            <p className="m-0 max-w-[420px] text-[13.5px] leading-relaxed text-ink-dim">
              No approved, automatable cases in this run. Approve non-Manual test cases in the Review
              Center, then generate automation here.
            </p>
          )}
        </div>
      )}

      {!thinking && specs && specs.length > 0 && (
        <div className="grid grid-cols-[230px_1fr] items-start gap-3.5">
          <GlassCard className="p-2">
            <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold tracking-wider text-faint">
              APPROVED SPECS
            </div>
            <div className="flex flex-col gap-0.5">
              {specs.map((s) => {
                const active = selectedSpec?.testCaseId === s.testCaseId;
                return (
                  <button
                    key={s.id}
                    onClick={() => selectSpec(s.testCaseId)}
                    className="flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-white/5"
                    style={active ? { background: "rgba(139,92,246,.14)" } : undefined}
                  >
                    <FileCode size={14} color={active ? "#a78bfa" : "#8b8b9e"} />
                    <span className="flex-1 truncate font-mono text-xs text-ink-soft">{s.filename}</span>
                    <SpecStatusDot
                      status={resultStatusByCase.get(s.testCaseId)}
                      healing={
                        healProgress?.caseId === s.testCaseId &&
                        healProgress?.phase !== "passed" &&
                        healProgress?.phase !== "failed"
                      }
                    />
                  </button>
                );
              })}
            </div>
          </GlassCard>

          <div className="flex min-w-0 flex-col gap-3.5">
          <div
            className="overflow-hidden rounded-2xl border border-white/[0.09]"
            style={{ background: "rgba(8,8,13,.8)", backdropFilter: "blur(22px)" }}
          >
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
              <span className="font-mono text-[12.5px] text-ink-soft">tests/{selectedSpec?.filename}</span>
              <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(34,211,238,.13)", color: "#67e8f9" }}>
                TypeScript
              </span>
              <div className="ml-auto flex gap-1.5">
                {editing ? (
                  <>
                    <button
                      onClick={saveEdit}
                      disabled={updateSpec.isPending}
                      className="flex items-center gap-1.5 rounded-[9px] border border-violet/40 bg-violet/20 px-[11px] py-1.5 text-[11.5px] font-semibold text-violet hover:bg-violet/30 disabled:opacity-60"
                    >
                      <Save size={13} />
                      {updateSpec.isPending ? "Saving…" : "Save"}
                    </button>
                    <button
                      onClick={cancelEdit}
                      disabled={updateSpec.isPending}
                      className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
                    >
                      <X size={13} />
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      onClick={collapseAll}
                      disabled={foldRanges.length === 0}
                      className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-40"
                    >
                      Collapse all
                    </button>
                    <button
                      onClick={expandAll}
                      disabled={folded.size === 0}
                      className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-40"
                    >
                      Expand all
                    </button>
                    <button
                      onClick={startEdit}
                      disabled={generating || specRegenerating}
                      className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-40"
                    >
                      <Pencil size={13} />
                      Edit
                    </button>
                    <button
                      onClick={() => selectedSpec && regenerateSpec.mutate(selectedSpec.testCaseId)}
                      disabled={specRegenerating}
                      className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
                    >
                      {specRegenerating ? (
                        <span
                          className="h-[13px] w-[13px] rounded-full border-2"
                          style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
                        />
                      ) : (
                        <RotateCcw size={13} />
                      )}
                      {specRegenerating ? "Regenerating…" : "Regenerate"}
                    </button>
                    <button
                      onClick={runThisSpec}
                      disabled={generating || specRegenerating || healingThisCase || runningThisSpec}
                      title="Run only this spec"
                      className="flex items-center gap-1.5 rounded-[9px] border border-cyan-400/25 bg-cyan-400/10 px-[11px] py-1.5 text-[11.5px] font-semibold text-cyan-300 hover:bg-cyan-400/20 disabled:opacity-60"
                    >
                      {runningThisSpec ? (
                        <span
                          className="h-[13px] w-[13px] rounded-full border-2"
                          style={{ borderColor: "rgba(34,211,238,.35)", borderTopColor: "#22d3ee", animation: "spin .8s linear infinite" }}
                        />
                      ) : (
                        <Play size={13} fill="currentColor" />
                      )}
                      {runningThisSpec ? "Running…" : "Run"}
                    </button>
                    <button
                      onClick={startHeal}
                      disabled={generating || specRegenerating || healingThisCase}
                      title="Run this spec; if it fails, let Claude fix it from the error and retry"
                      className="flex items-center gap-1.5 rounded-[9px] border border-emerald-400/25 bg-emerald-400/10 px-[11px] py-1.5 text-[11.5px] font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-60"
                    >
                      {healingThisCase ? (
                        <span
                          className="h-[13px] w-[13px] rounded-full border-2"
                          style={{ borderColor: "rgba(52,211,153,.35)", borderTopColor: "#34d399", animation: "spin .8s linear infinite" }}
                        />
                      ) : (
                        <Wand2 size={13} />
                      )}
                      {healingThisCase ? "Healing…" : "Self-heal"}
                    </button>
                    <button
                      onClick={handleCopy}
                      disabled={specRegenerating}
                      className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
                    >
                      {copyLabel}
                    </button>
                    <button
                      onClick={handleDownload}
                      disabled={specRegenerating}
                      className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
                    >
                      <Download size={13} />
                      Download
                    </button>
                  </>
                )}
              </div>
            </div>
            {editing ? (
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                wrap="off"
                className="block w-full resize-y overflow-auto whitespace-pre px-4 py-[18px] font-mono text-[12.5px] leading-[1.75] text-ink outline-none"
                style={{ minHeight: 380, background: "rgba(8,8,13,.6)", tabSize: 2 }}
              />
            ) : selectedSpec ? (
              <div className="relative">
                <div
                  style={{
                    opacity: generating || specRegenerating ? 0.4 : 1,
                    transition: "opacity .2s ease",
                  }}
                >
                  <CodeHighlight
                    code={selectedSpec.code}
                    foldRanges={foldRanges}
                    folded={folded}
                    onToggle={toggleFold}
                  />
                </div>
                {(generating || specRegenerating) && (
                  <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-8">
                    <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3.5 py-1.5 text-[11.5px] font-semibold text-ink-soft backdrop-blur">
                      <span
                        className="h-[13px] w-[13px] rounded-full border-2"
                        style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
                      />
                      {specRegenerating ? "Regenerating…" : "Updating…"}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex items-center gap-2.5 border-t border-white/[0.06] px-4 py-3.5">
              <span className="flex-1 text-xs text-muted">Execute the approved suite in parallel across the Run</span>
              <button
                onClick={startExecutionAndView}
                disabled={startExecution.isPending}
                className="flex items-center gap-2 rounded-xl px-[18px] py-2.5 text-[13px] font-bold text-white disabled:opacity-60"
                style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", boxShadow: "0 8px 22px -8px rgba(139,92,246,.8)" }}
              >
                <Play size={14} fill="#fff" />
                Run tests
              </button>
            </div>
          </div>
          {healReport && <HealTimeline report={healReport} />}
          </div>
        </div>
      )}
    </div>
  );
}

/** Relative "time ago" from an ISO timestamp, for the heal report header. */
function healTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Renders a unified-diff string with +/-/@@ lines colored. */
function DiffBlock({ diff }: { diff: string }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-white/[0.07] bg-[rgba(8,8,13,.6)] p-2.5">
      <pre className="m-0 font-mono text-[11.5px] leading-[1.6]">
        {diff.split("\n").map((line, i) => {
          const c = line.startsWith("+")
            ? "#6ee7b7"
            : line.startsWith("-")
              ? "#fb7185"
              : line.startsWith("@@")
                ? "#67e8f9"
                : "#8b8b9e";
          return (
            <div key={i} style={{ color: c, whiteSpace: "pre" }}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** Collapsible "Self-heal timeline" — the per-attempt failure, what Claude
 * changed (diff), and the final outcome of the last heal for a spec. */
function HealTimeline({ report }: { report: HealReport }) {
  const [open, setOpen] = useState(true);
  const healed = report.finalStatus === "pass";
  const n = report.attempts.length;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09]" style={{ background: "rgba(8,8,13,.55)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-4 py-3 text-left hover:bg-white/[0.03]"
      >
        <Wand2 size={14} className="shrink-0 text-emerald-300" />
        <span className="text-[13px] font-bold">Self-heal timeline</span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={
            healed
              ? { background: "rgba(16,185,129,.14)", color: "#6ee7b7" }
              : { background: "rgba(244,63,94,.14)", color: "#fb7185" }
          }
        >
          {healed ? `Healed after ${n} attempt${n === 1 ? "" : "s"}` : `Still failing after ${n} attempt${n === 1 ? "" : "s"}`}
        </span>
        <span className="ml-auto text-[11px] text-faint">{healTimeAgo(report.healedAt)}</span>
        <ChevronDown
          size={15}
          className="shrink-0 text-muted transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 p-3.5">
          {report.attempts.map((a: HealAttempt) => (
            <div key={a.attempt} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-bold">Attempt {a.attempt}</span>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                  style={
                    a.status === "pass"
                      ? { background: "rgba(16,185,129,.14)", color: "#6ee7b7" }
                      : { background: "rgba(244,63,94,.14)", color: "#fb7185" }
                  }
                >
                  {a.status === "pass" ? "PASSED" : "FAILED"}
                </span>
                <span className="ml-auto font-mono text-[11px] text-faint">
                  {(a.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              {a.error && (
                <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-[rgba(8,8,13,.6)] p-2.5">
                  <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-[#f2b8c0]">
                    {a.error}
                  </pre>
                </div>
              )}
              {a.fixed && (
                <>
                  <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-300">
                    <Wand2 size={12} /> Claude rewrote the spec
                  </div>
                  {a.diff && <DiffBlock diff={a.diff} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small colored dot showing a spec's latest execution outcome (or heal-in-flight). */
function SpecStatusDot({ status, healing }: { status?: string; healing?: boolean }) {
  const running = healing || status === "running";
  const color = running
    ? "#fbbf24"
    : status === "pass"
      ? "#34d399"
      : status === "fail"
        ? "#fb7185"
        : "#3f3f4a";
  return (
    <span
      className={`h-[7px] w-[7px] shrink-0 rounded-full ${running ? "animate-pulse" : ""}`}
      style={{ background: color }}
    />
  );
}

const TS_KEYWORDS = new Set([
  "import", "export", "from", "const", "let", "var", "async", "await", "function",
  "test", "expect", "describe", "it", "return", "if", "else", "new", "class",
  "extends", "interface", "type", "for", "of", "in", "typeof",
]);
const TS_KEYWORD_SPLIT = /\b([a-zA-Z]+)\b/g;

/** A collapsible region of code, identified by its opener and closer line indices (0-based). */
type FoldRange = { start: number; end: number };

const CLOSE_FOR: Record<string, string> = { "{": "}", "(": ")", "[": "]" };
const OPEN_FOR: Record<string, string> = { "}": "{", ")": "(", "]": "[" };

/**
 * Derive foldable brace/bracket regions from source code.
 *
 * Scans the code character by character while skipping strings, line comments,
 * and block comments (best-effort, never throws), tracking a stack of open
 * bracket positions. When a matching closer is found on a later line the span
 * is recorded. Only the widest region per opener line is kept, so each opener
 * folds down to its furthest matching closer. Single-line pairs are not
 * foldable.
 *
 * @param code Full spec source text.
 * @returns Fold ranges sorted by opener line, each spanning 2+ lines.
 */
function computeFoldRanges(code: string): FoldRange[] {
  const lines = code.split("\n");
  const stack: { char: string; line: number }[] = [];
  const endByStart = new Map<number, number>();

  let inStr: string | null = null;
  let inBlockComment = false;

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    for (let ci = 0; ci < line.length; ci++) {
      const ch = line[ci];
      const next = line[ci + 1];

      if (inBlockComment) {
        if (ch === "*" && next === "/") {
          inBlockComment = false;
          ci++;
        }
        continue;
      }
      if (inStr) {
        if (ch === "\\") ci++;
        else if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === "/" && next === "/") break; // line comment: skip rest of line
      if (ch === "/" && next === "*") {
        inBlockComment = true;
        ci++;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "{" || ch === "(" || ch === "[") {
        stack.push({ char: ch, line: li });
        continue;
      }
      if (ch === "}" || ch === ")" || ch === "]") {
        const open = OPEN_FOR[ch];
        let idx = stack.length - 1;
        while (idx >= 0 && stack[idx].char !== open) idx--;
        if (idx >= 0) {
          const opener = stack[idx];
          stack.length = idx; // pop the match and any unclosed openers above it
          if (li > opener.line) {
            const prev = endByStart.get(opener.line);
            if (prev === undefined || li > prev) endByStart.set(opener.line, li);
          }
        }
      }
    }
  }

  return [...endByStart.entries()]
    .map(([start, end]) => ({ start, end }))
    .sort((a, b) => a.start - b.start);
}

/** Closing bracket char for a fold's opener line (from its last non-space char). */
function closerCharFor(line: string): string {
  const trimmed = line.trimEnd();
  return CLOSE_FOR[trimmed[trimmed.length - 1]] ?? "}";
}

/**
 * Read-only TypeScript viewer with brace-based code folding.
 *
 * Renders every line with a sticky left gutter (line number + fold chevron on
 * opener lines) and the existing token highlighting. Lines inside a collapsed
 * region are hidden; the opener line gets an inline "N lines" marker. The outer
 * container keeps horizontal scrolling for long lines.
 *
 * @param code Full spec source text.
 * @param foldRanges Precomputed foldable regions for this code.
 * @param folded Set of opener line indices that are currently collapsed.
 * @param onToggle Toggles the fold state of the region opening at a line.
 */
function CodeHighlight({
  code,
  foldRanges,
  folded,
  onToggle,
}: {
  code: string;
  foldRanges: FoldRange[];
  folded: Set<number>;
  onToggle: (start: number) => void;
}) {
  const lines = code.split("\n");
  const endByStart = useMemo(() => new Map(foldRanges.map((r) => [r.start, r.end])), [foldRanges]);

  // Line indices hidden because they sit inside a currently-collapsed region.
  const hidden = useMemo(() => {
    const set = new Set<number>();
    for (const start of folded) {
      const end = endByStart.get(start);
      if (end === undefined) continue;
      for (let i = start + 1; i <= end; i++) set.add(i);
    }
    return set;
  }, [folded, endByStart]);

  const gutterBg = "#0b0b12";

  return (
    <div className="overflow-x-auto font-mono text-[12.5px] leading-[1.75] text-ink">
      <div className="min-w-max py-[18px]">
        {lines.map((line, i) => {
          if (hidden.has(i)) return null;
          const end = endByStart.get(i);
          const isFoldable = end !== undefined;
          const isFolded = isFoldable && folded.has(i);
          return (
            <div key={i} className="flex">
              <span
                className="sticky left-0 z-10 flex select-none items-center gap-1 pl-4 pr-3"
                style={{ background: gutterBg }}
              >
                {isFoldable ? (
                  <button
                    type="button"
                    onClick={() => onToggle(i)}
                    className="flex h-[14px] w-[14px] items-center justify-center text-faint hover:text-ink-soft"
                    aria-label={isFolded ? "Expand region" : "Collapse region"}
                  >
                    {isFolded ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                  </button>
                ) : (
                  <span className="h-[14px] w-[14px]" />
                )}
                <span className="w-8 text-right text-faint">{i + 1}</span>
              </span>
              <span className="whitespace-pre pl-3 pr-5">
                {highlightLine(line) || " "}
                {isFolded ? (
                  <span className="text-faint">
                    {" "}
                    &#8943; {end - i} lines {closerCharFor(line)}
                  </span>
                ) : null}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function highlightLine(line: string) {
  const tokens: { text: string; cls?: string }[] = [];
  const pattern = /(\/\/.*$)|('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(line))) {
    if (m.index > last) tokens.push({ text: line.slice(last, m.index) });
    tokens.push({ text: m[0], cls: m[1] ? "cmt" : "str" });
    last = m.index + m[0].length;
  }
  if (last < line.length) tokens.push({ text: line.slice(last) });

  return tokens.map((t, i) => {
    if (t.cls === "cmt") return <span key={i} style={{ color: "#6c6c7e" }}>{t.text}</span>;
    if (t.cls === "str") return <span key={i} style={{ color: "#a5d6a7" }}>{t.text}</span>;
    const parts = t.text.split(TS_KEYWORD_SPLIT);
    return (
      <span key={i}>
        {parts.map((p, j) =>
          TS_KEYWORDS.has(p) ? (
            <span key={j} style={{ color: "#c792ea" }}>
              {p}
            </span>
          ) : (
            p
          ),
        )}
      </span>
    );
  });
}
