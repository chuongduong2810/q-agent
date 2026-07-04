import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { Plus, ArrowRight, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/misc";
import { useRuns } from "@/hooks/queries";
import { useUI } from "@/store/ui";
import { runStatusToStage } from "@/components/ui/PipelineRail";
import type { RunOut } from "@/types/api";

const RUN_STATUS_LABEL: Record<string, string> = {
  processing: "AI processing",
  review: "Ready for review",
  sync: "Creating & linking",
  automation: "Automation",
  executing: "Executing",
  evidence: "Evidence ready",
  comment: "Publishing",
  done: "Complete",
};

/**
 * Runs list. Runs are independent and can be in flight concurrently, so every
 * non-done run is shown: the newest as the highlighted hero, the rest in an
 * "Active" list, and completed runs under "History".
 */
export function Runs() {
  const openCreateRun = useUI((s) => s.openCreateRun);
  const navigate = useNavigate();

  const { data: runs, isLoading } = useRuns();

  // Runs arrive newest-first (the API orders by created_at desc).
  const activeRuns = (runs ?? []).filter((r) => r.status !== "done");
  const heroRun = activeRuns[0];
  const otherActive = activeRuns.slice(1);
  const history = (runs ?? []).filter((r) => r.status === "done");

  const goRun = (run: RunOut) => navigate(`/runs/${run.id}`);
  const goReview = (run: RunOut) => navigate(`/runs/${run.id}/review`);

  return (
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            Batch QA sessions &middot; {activeRuns.length} active
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
          <div className="glass h-[110px] animate-pulse rounded-[20px]" />
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass h-[64px] animate-pulse rounded-2xl" />
          ))}
        </div>
      ) : !runs?.length ? (
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
          {heroRun && (
            <div
              onClick={() => goRun(heroRun)}
              className="relative mb-4 cursor-pointer overflow-hidden rounded-[20px] border p-[22px_24px] transition-colors hover:border-[rgba(139,92,246,.5)]"
              style={{
                background: "linear-gradient(135deg,rgba(139,92,246,.18),rgba(99,102,241,.08))",
                borderColor: "rgba(139,92,246,.28)",
              }}
            >
              <div
                className="pointer-events-none absolute -right-5 -top-[30px] h-[180px] w-[180px] rounded-full blur-[20px]"
                style={{ background: "radial-gradient(circle,rgba(139,92,246,.35),transparent 65%)" }}
              />
              <div className="relative flex items-center gap-4">
                <div className="flex-1">
                  <div className="mb-1.5 flex items-center gap-2.5">
                    <span className="font-mono text-[13px] font-bold text-violet">{heroRun.code}</span>
                    <span className="flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[11px] font-bold text-[#fbbf24]" style={{ background: "rgba(245,158,11,.14)" }}>
                      <span className="h-1.5 w-1.5 rounded-full bg-[#f59e0b]" style={{ animation: "pulseDot 1.6s infinite" }} />
                      {RUN_STATUS_LABEL[heroRun.status] ?? heroRun.status}
                    </span>
                  </div>
                  <div className="text-[19px] font-extrabold tracking-tight">{heroRun.name}</div>
                  <div className="mt-1.5 text-[12.5px] text-[#c3c3d4]">
                    {heroRun.scopeLabel} &middot; {heroRun.framework} &middot; {heroRun.env} &middot; {heroRun.workers} workers
                  </div>
                </div>
                <Button
                  variant="white"
                  onClick={(e) => {
                    e.stopPropagation();
                    goReview(heroRun);
                  }}
                >
                  Open Review Center
                  <ArrowRight size={14} strokeWidth={2.3} />
                </Button>
              </div>
            </div>
          )}

          {otherActive.length > 0 && (
            <>
              <div className="mb-3 text-[12px] font-bold tracking-[.08em] text-[#6c6c7e]">ACTIVE</div>
              <div className="mb-5 flex flex-col gap-[10px]">
                {otherActive.map((r, i) => (
                  <RunRow key={r.id} run={r} index={i} active onClick={() => goRun(r)} />
                ))}
              </div>
            </>
          )}

          <div className="mb-3 text-[12px] font-bold tracking-[.08em] text-[#6c6c7e]">HISTORY</div>
          {!history.length ? (
            <div className="glass rounded-2xl px-5 py-6 text-center text-[13px] text-ink-dim">
              No completed runs yet.
            </div>
          ) : (
            <div className="flex flex-col gap-[10px]">
              {history.map((r, i) => (
                <RunRow key={r.id} run={r} index={i} onClick={() => goRun(r)} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * A compact run row used by both the Active and History lists. Active rows get a
 * pulsing amber status dot; completed rows are static green (or amber if the run
 * ended before the final stage).
 */
function RunRow({
  run,
  index,
  onClick,
  active = false,
}: {
  run: RunOut;
  index: number;
  onClick: () => void;
  active?: boolean;
}) {
  const stage = runStatusToStage[run.status] ?? 8;
  const color = active ? "#f59e0b" : stage >= 8 ? "#10b981" : "#f59e0b";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
      onClick={onClick}
      className="glass flex cursor-pointer items-center gap-[14px] rounded-2xl p-[16px_18px] transition-colors hover:border-[rgba(139,92,246,.28)]"
    >
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{
          background: color,
          boxShadow: `0 0 10px ${color}`,
          ...(active ? { animation: "pulseDot 1.6s infinite" } : {}),
        }}
      />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-[9px]">
          <span className="font-mono text-[11.5px] font-semibold text-violet">{run.code}</span>
        </div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[14.5px] font-semibold">
          {run.name}
        </div>
      </div>
      <span className="shrink-0 text-[12px] text-ink-dim">
        {run.ticketIds.length} ticket{run.ticketIds.length === 1 ? "" : "s"}
      </span>
      <span className="shrink-0 whitespace-nowrap text-right text-[15px] font-extrabold" style={{ color }}>
        {RUN_STATUS_LABEL[run.status] ?? run.status}
      </span>
    </motion.div>
  );
}
