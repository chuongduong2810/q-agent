import { Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { execColors } from "@/components/ui/badges";
import { ProgressRing, Spinner } from "@/components/ui/misc";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { useExecution, useRun, useStartExecution } from "@/hooks/queries";
import { useRunSocket } from "@/hooks/useRunSocket";
import { useUI } from "@/store/ui";
import type { ExecutionResultOut } from "@/types/api";

/** Truncates long ticket ids for the fixed-width queue column (design's r.tidShort). */
function shortTicket(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

export function Execution() {
  const activeRunId = useUI((s) => s.activeRunId);
  const navigate = useUI((s) => s.navigate);

  const { data: run } = useRun(activeRunId);
  const { data: execution, isLoading } = useExecution(activeRunId);
  const startExecution = useStartExecution(activeRunId ?? 0);
  useRunSocket(activeRunId);

  const status = execution?.status ?? "idle";
  const isIdle = !execution || status === "idle" || status === "pending";
  const isRunning = status === "running";
  const isDone = status === "done" || status === "completed";

  const total = execution?.total ?? 0;
  const passed = execution?.passed ?? 0;
  const failed = execution?.failed ?? 0;
  const remaining = Math.max(0, total - passed - failed);
  const progress = execution?.progress ?? 0;

  const results = execution?.results ?? [];
  const runningResult = results.find((r) => r.status === "running");
  const current: ExecutionResultOut | undefined =
    runningResult ?? (isDone ? results[results.length - 1] : undefined);

  const handleRun = () => {
    startExecution.mutate(
      {},
      { onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to start execution") },
    );
  };

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-3.5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            {run?.code ?? `RUN-${activeRunId ?? "…"}`} &middot; {run?.framework ?? "Playwright"} &middot;{" "}
            {run?.env ?? "Staging"} &middot; {run?.workers ?? execution?.workers ?? 0} parallel workers
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Execution</h1>
        </div>
        <Button variant="primary" size="lg" onClick={handleRun} disabled={isRunning || startExecution.isPending}>
          {isRunning || startExecution.isPending ? (
            <>
              <Spinner size={15} />
              Running…
            </>
          ) : isDone ? (
            <>
              <RotateCw size={15} strokeWidth={2.4} />
              Re-run
            </>
          ) : (
            <>
              <Play size={15} fill="#fff" stroke="none" />
              Run suite
            </>
          )}
        </Button>
      </div>

      <div className="mb-3.5">
        <PipelineRail stage={7} />
      </div>

      <div className="mb-3.5 grid grid-cols-[1.1fr_1fr] gap-3.5">
        <div className="glass flex items-center gap-5 rounded-[18px] p-[18px_22px]">
          <ProgressRing value={progress} label={<span className="text-lg font-black">{progress}%</span>} />
          <div className="flex flex-1 gap-[18px]">
            <div>
              <div className="text-[22px] font-black leading-none text-[#6ee7b7]">{passed}</div>
              <div className="mt-0.5 text-[11px] text-ink-dim">Passed</div>
            </div>
            <div>
              <div className="text-[22px] font-black leading-none text-[#fb7185]">{failed}</div>
              <div className="mt-0.5 text-[11px] text-ink-dim">Failed</div>
            </div>
            <div>
              <div className="text-[22px] font-black leading-none text-[#c3c3d0]">{remaining}</div>
              <div className="mt-0.5 text-[11px] text-ink-dim">Remaining</div>
            </div>
          </div>
        </div>

        <div className="glass flex flex-col justify-center gap-2 rounded-[18px] p-[18px_22px]">
          <div className="text-[11px] font-semibold tracking-[.06em] text-[#6c6c7e]">CURRENTLY EXECUTING</div>
          <div className="flex items-center gap-2.5">
            <span className="font-mono text-[12px] font-semibold text-violet">
              {current?.ticketExternalId ?? "—"}
            </span>
            {isRunning && <Spinner size={13} />}
          </div>
          <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[13.5px] font-semibold text-[#dcdce4]">
            {current?.title ?? (isIdle ? "Not started" : "—")}
          </div>
          {isDone && (
            <Button variant="glass" size="sm" onClick={() => navigate("evidence")} className="mt-1 self-start">
              Collect evidence
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </Button>
          )}
        </div>
      </div>

      <div className="glass rounded-[18px] p-2">
        <div className="p-[9px_12px_6px] text-[11px] font-semibold tracking-[.08em] text-[#6c6c7e]">
          EXECUTION QUEUE &middot; {progress}%
        </div>
        {isLoading ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-[42px] animate-pulse rounded-xl bg-white/[0.04]" />
            ))}
          </div>
        ) : !results.length ? (
          <div className="p-6 text-center text-[13px] text-ink-dim">
            No cases queued yet. Run the suite to begin execution.
          </div>
        ) : (
          results.map((r) => <ExecRow key={r.id} result={r} />)
        )}
      </div>
    </div>
  );
}

function ExecRow({ result }: { result: ExecutionResultOut }) {
  const [color, label] = execColors[result.status] ?? execColors.pending;
  return (
    <div className="flex items-center gap-3 rounded-xl p-[11px_13px] transition-colors hover:bg-white/[0.04]">
      {result.status === "running" && <Spinner size={15} />}
      <span
        className="h-[9px] w-[9px] shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span className="w-[66px] shrink-0 font-mono text-[11px] font-semibold text-[#7a7a8c]">
        {shortTicket(result.ticketExternalId)}
      </span>
      <span className="shrink-0 font-mono text-[11.5px] font-semibold text-violet">{result.caseCode}</span>
      <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-[13px] text-[#dcdce4]">
        {result.title}
      </span>
      <span className="shrink-0 text-[11px] font-bold" style={{ color }}>
        {label}
      </span>
    </div>
  );
}
