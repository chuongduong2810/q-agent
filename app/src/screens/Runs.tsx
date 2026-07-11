import { motion } from "framer-motion";
import { ArrowRight, ListChecks, Loader2, Pause, Play, Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  isPausedRun,
  isTerminalRun,
  isWorkingRun,
  runBadge,
  runGroup,
  timeAgoShort,
} from "@/components/dashboard/runStatus";
import { RunActionsMenu } from "@/components/runs/RunActionsMenu";
import { RunBulkBar } from "@/components/runs/RunBulkBar";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/misc";
import { useRuns } from "@/hooks/queries";
import { useUI, type RunFilter } from "@/store/ui";
import type { RunOut } from "@/types/api";

/** Low-alpha tint of a 6-digit hex accent, for badge/pill backgrounds. */
const tint = (hex: string, alpha = "22") => `${hex}${alpha}`;

const STAT_CARDS: { key: Exclude<RunFilter, "all">; label: string; color: string }[] = [
  { key: "active", label: "Active", color: "#a78bfa" },
  { key: "review", label: "In review", color: "#f59e0b" },
  { key: "completed", label: "Completed", color: "#10b981" },
  { key: "failed", label: "Failed", color: "#fb7185" },
];

/**
 * Runs list — a filterable, multi-selectable batch-QA console. Summary tiles and
 * status filter tabs sit above a flat list of run rows; selecting rows raises an
 * animated bulk-action bar. Per-row case count / pass progress / pass rate come
 * from the aggregates on `RunOut` (GET /runs).
 */
export function Runs() {
  const openCreateRun = useUI((s) => s.openCreateRun);
  const runFilter = useUI((s) => s.runFilter);
  const setRunFilter = useUI((s) => s.setRunFilter);
  const runSel = useUI((s) => s.runSel);
  const toggleRunSel = useUI((s) => s.toggleRunSel);
  const clearRunSel = useUI((s) => s.clearRunSel);
  const navigate = useNavigate();

  const { data: runs, isLoading } = useRuns();
  const all = runs ?? [];

  const counts = {
    active: all.filter((r) => runGroup(r.status) === "active").length,
    review: all.filter((r) => runGroup(r.status) === "review").length,
    completed: all.filter((r) => runGroup(r.status) === "completed").length,
    failed: all.filter((r) => runGroup(r.status) === "failed").length,
  };

  const tabs: { key: RunFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: all.length },
    { key: "active", label: "Active", count: counts.active },
    { key: "review", label: "In review", count: counts.review },
    { key: "completed", label: "Completed", count: counts.completed },
    { key: "failed", label: "Failed", count: counts.failed },
  ];

  // Surface actionable runs first (needs-you review → in-flight → completed →
  // failed → cancelled); within a group the API's newest-first order is kept
  // (Array.sort is stable).
  const GROUP_ORDER: Record<string, number> = {
    review: 0,
    active: 1,
    completed: 2,
    failed: 3,
    other: 4,
  };
  const filtered = all
    .filter((r) => runFilter === "all" || runGroup(r.status) === runFilter)
    .sort((a, b) => GROUP_ORDER[runGroup(a.status)] - GROUP_ORDER[runGroup(b.status)]);
  const selected = all.filter((r) => runSel[r.id]);

  return (
    <div className="px-1 pb-24 pt-0.5">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            Batch QA sessions &middot; run many in parallel
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Runs</h1>
        </div>
        <Button variant="primary" onClick={openCreateRun}>
          <Plus size={15} strokeWidth={2.4} />
          Create Run
        </Button>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-[10px]">
          <div className="mb-2 grid grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="glass h-[74px] animate-pulse rounded-[16px]" />
            ))}
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass h-[84px] animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : !all.length ? (
        <EmptyState
          icon={<ListChecks size={28} color="#8b8b9e" strokeWidth={1.6} />}
          title="No runs yet"
          body="Create a run to start a batch QA session across one or many tickets."
          action={
            <Button variant="primary" onClick={openCreateRun}>
              <Plus size={15} strokeWidth={2.4} />
              Create Run
            </Button>
          }
        />
      ) : (
        <>
          {/* Summary tiles */}
          <div className="mb-4 grid grid-cols-4 gap-3">
            {STAT_CARDS.map((c) => (
              <div key={c.key} className="glass rounded-[16px] px-[18px] py-[15px]">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: c.color }} />
                  <span className="text-[26px] font-black leading-none tracking-tight">
                    {counts[c.key]}
                  </span>
                </div>
                <div className="mt-1.5 text-[13px] text-ink-dim">{c.label}</div>
              </div>
            ))}
          </div>

          {/* Status filter tabs */}
          <div className="mb-4 flex flex-wrap gap-2">
            {tabs.map((t) => {
              const active = runFilter === t.key;
              return (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setRunFilter(t.key)}
                  className={`flex items-center gap-1.5 rounded-[10px] px-3 py-[7px] text-[13px] font-semibold transition-colors ${
                    active
                      ? "bg-white/[0.1] text-ink"
                      : "text-ink-dim hover:bg-white/[0.05] hover:text-ink-soft"
                  }`}
                >
                  {t.label}
                  <span className={active ? "text-ink-soft" : "text-ink-dim/70"}>{t.count}</span>
                </button>
              );
            })}
          </div>

          {/* Run rows */}
          {!filtered.length ? (
            <div className="glass rounded-2xl px-5 py-8 text-center text-[13px] text-ink-dim">
              No runs in this view.
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {filtered.map((r, i) => (
                <RunRow
                  key={r.id}
                  run={r}
                  index={i}
                  selected={!!runSel[r.id]}
                  onToggle={() => toggleRunSel(r.id)}
                  onOpen={() => navigate(`/runs/${r.id}`)}
                  onPlay={() => navigate(`/runs/${r.id}/execution`)}
                />
              ))}
            </div>
          )}
        </>
      )}

      <RunBulkBar selected={selected} onClear={clearRunSel} />
    </div>
  );
}

function RunRow({
  run,
  index,
  selected,
  onToggle,
  onOpen,
  onPlay,
}: {
  run: RunOut;
  index: number;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
  onPlay: () => void;
}) {
  const badge = runBadge(run.status);
  const working = isWorkingRun(run.status);
  const paused = isPausedRun(run.status);
  const isReview = run.status === "review";
  // Play (start/watch execution) is offered once a run is past analysis and not
  // terminal — i.e. review and every later in-flight stage.
  const canRun = !isTerminalRun(run.status) && run.status !== "processing";
  const showProgress = run.total > 0;
  const pct = showProgress ? Math.round((run.passed / run.total) * 100) : 0;
  const barColor = run.status === "done" ? "#10b981" : "#a78bfa";

  const borderStyle = selected
    ? { borderColor: "rgba(139,92,246,.6)", background: "rgba(139,92,246,.06)" }
    : isReview
      ? { borderColor: "rgba(245,158,11,.45)", background: "rgba(245,158,11,.04)" }
      : undefined;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(index * 0.03, 0.25), ease: "easeOut" }}
      onClick={onOpen}
      className="glass flex cursor-pointer items-center gap-[14px] rounded-2xl px-[16px] py-[14px] transition-colors hover:border-[rgba(139,92,246,.28)]"
      style={borderStyle}
    >
      {/* Select checkbox */}
      <button
        type="button"
        aria-label={selected ? "Deselect run" : "Select run"}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[6px] border transition-colors ${
          selected
            ? "border-transparent bg-violet text-white"
            : "border-white/25 hover:border-white/50"
        }`}
      >
        {selected && (
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
      </button>

      {/* Status tile */}
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] bg-white/[0.05]">
        {working ? (
          <Loader2 size={17} strokeWidth={2.2} className="animate-spin" style={{ color: badge.color }} />
        ) : paused ? (
          <Pause size={15} strokeWidth={2.4} fill={badge.color} style={{ color: badge.color }} />
        ) : (
          <span
            className="h-2.5 w-2.5 rounded-full"
            style={{ background: badge.color, boxShadow: `0 0 8px ${badge.color}` }}
          />
        )}
      </span>

      {/* Main info */}
      <div className="min-w-0 flex-1">
        <div className="mb-[3px] flex items-center gap-2">
          <span className="font-mono text-[11.5px] font-bold text-violet">{run.code}</span>
          <span
            className="flex items-center gap-1.5 rounded-full px-2 py-[2px] text-[11px] font-bold"
            style={{ background: tint(badge.color), color: badge.color }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: badge.color }} />
            {badge.label}
          </span>
          {isReview && (
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-[#f59e0b]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" style={{ animation: "pulseDot 1.6s infinite" }} />
              needs you
            </span>
          )}
        </div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[15px] font-semibold">
          {run.name}
        </div>
        <div className="mt-[3px] truncate text-[12px] text-ink-dim">
          {run.ticketIds.length} ticket{run.ticketIds.length === 1 ? "" : "s"} &middot; {run.caseCount}{" "}
          case{run.caseCount === 1 ? "" : "s"} &middot; {run.framework} &middot; {run.env}
        </div>
      </div>

      {/* Progress */}
      {showProgress && (
        <div className="hidden w-[140px] shrink-0 flex-col gap-1.5 sm:flex">
          <div className="flex items-center gap-2">
            <span className="text-[11.5px] font-bold text-ink-soft">
              {run.passed}/{run.total}
            </span>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.1]">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: barColor }} />
            </div>
          </div>
          <div className="text-[11px] text-ink-dim">
            Pass {run.passRate != null ? `${Math.round(run.passRate)}%` : "—"} &middot;{" "}
            {timeAgoShort(run.finishedAt ?? run.createdAt)}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex shrink-0 items-center gap-1.5">
        {canRun && (
          <button
            type="button"
            title="Run execution"
            onClick={(e) => {
              e.stopPropagation();
              onPlay();
            }}
            className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-[rgba(139,92,246,.18)] text-violet transition-colors hover:bg-[rgba(139,92,246,.3)]"
          >
            <Play size={14} strokeWidth={2.4} fill="currentColor" />
          </button>
        )}
        <button
          type="button"
          title="Open run"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/[0.05] text-ink-soft transition-colors hover:bg-white/[0.1]"
        >
          <ArrowRight size={15} strokeWidth={2.2} />
        </button>
        <RunActionsMenu run={run} />
      </div>
    </motion.div>
  );
}
