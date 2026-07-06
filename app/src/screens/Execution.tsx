import { useCallback, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, KeyRound, Play, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Pill, execColors, productDefectStyle } from "@/components/ui/badges";
import { ProgressRing, Spinner } from "@/components/ui/misc";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { useNavigate, useParams } from "react-router-dom";
import { useExecution, useRun, useStartExecution } from "@/hooks/queries";
import { useRunEvents } from "@/hooks/useRunEvents";
import type { ExecutionResultOut, ProgressEvent } from "@/types/api";

/** Truncates long ticket ids for the fixed-width queue column (design's r.tidShort). */
function shortTicket(id: string): string {
  return id.length > 10 ? id.slice(0, 10) : id;
}

export function Execution() {
  const runId = Number(useParams().runId);
  const navigate = useNavigate();

  const { data: run } = useRun(runId);
  const { data: execution, isLoading } = useExecution(runId);
  const startExecution = useStartExecution(runId);

  // Manual-login prompt state, driven by the run WebSocket. When the backend
  // opens a browser on the host for the operator to log in, it emits
  // `exec.auth.waiting`; `exec.auth.captured`/`exec.auth.error` clear it.
  const [authWaiting, setAuthWaiting] = useState<{ url: string } | null>(null);
  const onRunEvent = useCallback((evt: ProgressEvent) => {
    if (evt.event === "exec.auth.waiting") {
      setAuthWaiting({ url: String(evt.payload?.url ?? "") });
    } else if (evt.event === "exec.auth.captured") {
      setAuthWaiting(null);
      toast.success("Login captured");
    } else if (evt.event === "exec.auth.error") {
      setAuthWaiting(null);
      toast.error(String(evt.payload?.message ?? "Manual login failed"));
    }
  }, []);
  useRunEvents(onRunEvent);

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
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-3.5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            {run?.code ?? `RUN-${runId}`} &middot; {run?.framework ?? "Playwright"} &middot;{" "}
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

      {authWaiting && (
        <div
          className="mb-3.5 flex items-center gap-3.5 rounded-[16px] p-[15px_18px]"
          style={{ background: "rgba(139,92,246,.12)", border: "1px solid rgba(139,92,246,.34)" }}
        >
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
          >
            <KeyRound size={18} color="#fff" strokeWidth={2.2} />
          </div>
          <div className="flex-1">
            <div className="mb-0.5 flex items-center gap-2 text-[14px] font-bold">
              <Spinner size={13} /> Waiting for manual login
            </div>
            <p className="m-0 text-[12.5px] leading-relaxed text-[#c3c3d4]">
              A browser has opened on the host machine. Log in
              {authWaiting.url ? (
                <>
                  {" "}at{" "}
                  <a
                    href={authWaiting.url}
                    target="_blank"
                    rel="noreferrer"
                    className="break-all font-mono text-violet hover:text-[#c4b5fd]"
                  >
                    {authWaiting.url}
                  </a>
                </>
              ) : null}
              , then close the window to continue.
            </p>
          </div>
        </div>
      )}

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
            <Button variant="glass" size="sm" onClick={() => navigate("/runs/" + runId + "/evidence")} className="mt-1 self-start">
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

      {execution?.log ? <ExecutionLog log={execution.log} /> : null}
    </div>
  );
}

/** Collapsible panel showing raw Playwright stdout/stderr for the run. Collapsed by default. */
function ExecutionLog({ log }: { log: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="glass mt-3.5 rounded-[18px] p-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-xl bg-transparent p-[9px_12px] text-left transition-colors hover:bg-white/[0.04]"
        aria-expanded={open}
      >
        {open ? (
          <ChevronDown size={14} className="text-ink-dim" />
        ) : (
          <ChevronRight size={14} className="text-ink-dim" />
        )}
        <span className="text-[11px] font-semibold tracking-[.08em] text-[#6c6c7e]">EXECUTION LOG</span>
      </button>
      {open && (
        <pre className="mx-1 mb-1 max-h-[320px] overflow-auto whitespace-pre-wrap rounded-xl border border-white/[0.09] bg-[rgba(8,8,13,.7)] p-3.5 font-mono text-[12px] leading-relaxed text-[#c7c7d4]">
          {log}
        </pre>
      )}
    </div>
  );
}

function ExecRow({ result }: { result: ExecutionResultOut }) {
  // A confirmed product defect is a failed case whose failureClass says so. It gets
  // the fuchsia "Product defect" treatment (dot glow, label, pill) so it reads
  // distinctly from a plain red script "Failed". Any other status — or a fail that
  // is unclassified / not a product defect — renders with the shared execColors.
  const isProductDefect = result.status === "fail" && result.failureClass === "product_defect";
  const [color, label] = isProductDefect
    ? productDefectStyle
    : (execColors[result.status] ?? execColors.pending);
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
      {isProductDefect ? (
        <Pill color={color} bg="rgba(217,70,239,.14)">
          <AlertTriangle size={11} strokeWidth={2.4} />
          {label}
        </Pill>
      ) : (
        <span className="shrink-0 text-[11px] font-bold" style={{ color }}>
          {label}
        </span>
      )}
    </div>
  );
}
