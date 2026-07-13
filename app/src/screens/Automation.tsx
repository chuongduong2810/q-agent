import { RotateCcw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  ALL_TICKETS_PAGE_SIZE,
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
import { queryKeys } from "@/lib/queryKeys";
import type { HealReport } from "@/types/api";
import { normalizeSpecStatus, parseGateReport } from "./automation/specStatus";
import { useAutomationEvents } from "./automation/useAutomationEvents";
import { useThinkingSteps } from "./automation/useThinkingSteps";
import { useCodeFolding } from "./automation/useCodeFolding";
import { TargetRepoPanel } from "./automation/TargetRepoPanel";
import { ThinkingBanner, GeneratingBanner, HealProgressBanner } from "./automation/ProgressBanners";
import { NoAutomationEmptyState } from "./automation/EmptyState";
import { SpecList } from "./automation/SpecList";
import { ProductDefectBanner, BlockedBanner } from "./automation/banners";
import { SpecCodePanel } from "./automation/SpecCodePanel";
import { HealTimeline } from "./automation/HealTimeline";
import { diffLines } from "./automation/lineDiff";
import { RegenSummary, deriveTags } from "./automation/RegenSummary";

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
  const { data: ticketsPage } = useTickets({ pageSize: ALL_TICKETS_PAGE_SIZE });
  const tickets = ticketsPage?.items;
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

  // Ephemeral, client-side inline-diff state for the last regeneration of the
  // selected case: which lines changed vs the previous code, a lines-changed
  // count, heuristic tags, and a per-case version number. Cleared when the
  // selected case changes; never persisted (no migration).
  const [regenResult, setRegenResult] = useState<{
    caseId: number;
    prevCode: string;
    changed: Set<number>;
    count: number;
    tags: string[];
    version: number;
  } | null>(null);
  const [versionByCase, setVersionByCase] = useState<Record<number, number>>({});
  // Bumped by the RegenSummary "Feedback" button to force-open the note composer.
  const [feedbackSignal, setFeedbackSignal] = useState(0);
  // Generation runs in the background on the server; the POST returns
  // immediately. Derive the running state from the persisted server status so it
  // survives navigation and blocks re-triggering.
  const generating = (autoStatus?.generating ?? false) || generateAutomation.isPending;

  // Live generation + self-heal progress from the run's WS stream.
  const { genProgress, healProgress } = useAutomationEvents(runId, generating);

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
  const thinkStep = useThinkingSteps(thinking);

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

  // Code-folding state for the read-only spec viewer. Reset whenever the selected
  // spec changes so folds never carry over between files.
  const { foldRanges, folded, toggleFold, collapseAll, expandAll } = useCodeFolding(
    selectedSpec?.code,
    `${selectedSpec?.testCaseId}:${selectedSpec?.filename}`,
  );

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

  // Authoritative status for the selected spec, driving which actions are
  // suppressed and which status banner shows in the right panel.
  const selectedStatus = normalizeSpecStatus(selectedSpec?.status);
  const runSuppressed = selectedStatus === "blocked" || selectedStatus === "product_defect";
  const isProductDefect = selectedStatus === "product_defect";
  const isBlocked = selectedStatus === "blocked";
  // Last placeholder-gate outcome for the selected spec: surface a non-destructive
  // note when the most recent regeneration was rejected (previous good spec kept).
  const gateReport = useMemo(() => parseGateReport(selectedSpec?.gateReport), [selectedSpec?.gateReport]);
  const gateRejected = gateReport?.outcome === "rejected";

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
  // or hits the attempts cap. Progress streams over WS (see useAutomationEvents).
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

  // Clear the inline-diff banner whenever the selected case changes so a diff
  // never bleeds across specs.
  useEffect(() => {
    setRegenResult(null);
  }, [selectedSpecCaseId]);

  // Regenerate the selected spec, optionally with a reviewer note. Captures the
  // current code first so success can diff old vs new; a regeneration that leaves
  // the code unchanged OR comes back blocked shows no diff banner (the
  // GateRejectedNote / BlockedBanner already explain those outcomes).
  const handleRegenerate = (comment?: string) => {
    if (!selectedSpec) return;
    const caseId = selectedSpec.testCaseId;
    const prevCode = selectedSpec.code;
    regenerateSpec.mutate(
      { caseId, comment },
      {
        onSuccess: (data) => {
          if (data.code === prevCode || data.status === "blocked") return;
          const { changed, count, removed } = diffLines(prevCode, data.code);
          const nextLines = data.code.split("\n");
          const added = [...changed].map((i) => nextLines[i] ?? "");
          const tags = deriveTags(added, removed);
          const nextVersion = (versionByCase[caseId] ?? 1) + 1;
          setVersionByCase((prev) => ({ ...prev, [caseId]: nextVersion }));
          setRegenResult({ caseId, prevCode, changed, count, tags, version: nextVersion });
        },
        onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to regenerate spec"),
      },
    );
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
      <div className="mb-3.5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-1 text-[13px] font-medium text-muted">
            {run?.code} &middot; Playwright · TypeScript · approved cases only
          </div>
          <h1 className="m-0 text-[24px] font-black tracking-tight md:text-[28px]">Automation</h1>
        </div>
        {specCount > 0 && (
          <div className="flex flex-col gap-2 md:flex-row md:items-center">
            {missingCount > 0 && (
              <Button variant="primary" onClick={startGenerate} disabled={generating} className="w-full md:w-auto">
                <Sparkles size={15} strokeWidth={2.2} /> Generate new ({missingCount})
              </Button>
            )}
            <Button variant="glass" onClick={regenerateAll} disabled={generating} className="w-full md:w-auto">
              <RotateCcw size={15} strokeWidth={2.2} /> Regenerate all
            </Button>
          </div>
        )}
      </div>
      <div className="mb-4 hidden md:block">
        <PipelineRail stage={6} />
      </div>

      {showRepoPanel && (
        <TargetRepoPanel
          runTickets={runTickets}
          tickets={tickets}
          repoSelectOptions={repoSelectOptions}
          repoStatusOf={repoStatusOf}
          defaultRepoName={defaultRepoName}
          onChangeRepo={(tid, repo) =>
            setTicketRepo.mutate(
              { tid, repo },
              {
                onError: (e) =>
                  toast.error(e instanceof Error ? e.message : "Failed to set repository"),
              },
            )
          }
        />
      )}

      {thinking && <ThinkingBanner runCode={run?.code} thinkStep={thinkStep} />}

      {generating && !thinking && <GeneratingBanner genProgress={genProgress} />}

      {healProgress && healProgress.phase !== "passed" && healProgress.phase !== "failed" && (
        <HealProgressBanner healProgress={healProgress} />
      )}

      {!thinking && specs && specs.length === 0 && (
        <NoAutomationEmptyState
          automatableCount={automatableCount}
          generating={generating}
          onGenerate={startGenerate}
        />
      )}

      {!thinking && specs && specs.length > 0 && (
        <div className="flex flex-col gap-3.5 md:grid md:grid-cols-[230px_1fr] md:items-start">
          <SpecList
            specs={specs}
            selectedTestCaseId={selectedSpec?.testCaseId ?? null}
            resultStatusByCase={resultStatusByCase}
            healProgress={healProgress}
            onSelect={selectSpec}
          />

          <div className="flex min-w-0 flex-col gap-3.5">
          {isProductDefect && <ProductDefectBanner />}
          {isBlocked && (
            <BlockedBanner
              reason={selectedSpec?.blockReason ?? ""}
              onRegenerate={handleRegenerate}
              regenerating={specRegenerating}
            />
          )}
          {regenResult && regenResult.caseId === selectedSpec?.testCaseId && (
            <RegenSummary
              version={regenResult.version}
              count={regenResult.count}
              tags={regenResult.tags}
              reverting={updateSpec.isPending}
              onFeedback={() => setFeedbackSignal((n) => n + 1)}
              onRevert={() => {
                if (!selectedSpec) return;
                updateSpec.mutate(
                  { caseId: selectedSpec.testCaseId, code: regenResult.prevCode },
                  {
                    onSuccess: () => {
                      setRegenResult(null);
                      toast.success("Reverted to previous spec");
                    },
                    onError: (e) =>
                      toast.error(e instanceof Error ? e.message : "Failed to revert spec"),
                  },
                );
              }}
            />
          )}
          <SpecCodePanel
            selectedSpec={selectedSpec}
            editing={editing}
            draft={draft}
            setDraft={setDraft}
            foldRanges={foldRanges}
            folded={folded}
            toggleFold={toggleFold}
            collapseAll={collapseAll}
            expandAll={expandAll}
            generating={generating}
            specRegenerating={specRegenerating}
            healingThisCase={healingThisCase}
            runningThisSpec={!!runningThisSpec}
            runSuppressed={runSuppressed}
            isBlocked={isBlocked}
            isProductDefect={isProductDefect}
            gateRejected={gateRejected}
            gateReport={gateReport}
            updateSpecPending={updateSpec.isPending}
            startExecutionPending={startExecution.isPending}
            copyLabel={copyLabel}
            changedLines={
              regenResult && regenResult.caseId === selectedSpec?.testCaseId
                ? regenResult.changed
                : undefined
            }
            regenVersion={selectedSpec ? versionByCase[selectedSpec.testCaseId] : undefined}
            feedbackSignal={feedbackSignal}
            onCopy={handleCopy}
            onDownload={handleDownload}
            onStartEdit={startEdit}
            onCancelEdit={cancelEdit}
            onSaveEdit={saveEdit}
            onRegenerate={handleRegenerate}
            onRunSpec={runThisSpec}
            onStartHeal={startHeal}
            onStartExecution={startExecutionAndView}
          />
          {healReport && <HealTimeline report={healReport} />}
          </div>
        </div>
      )}
    </div>
  );
}
