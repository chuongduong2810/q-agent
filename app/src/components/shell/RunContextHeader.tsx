import { CheckSquare, ChevronDown } from "lucide-react";
import { useRef, useState } from "react";
import { RunSwitcher } from "@/components/shell/RunSwitcher";
import { runStatusToStage } from "@/components/ui/PipelineRail";
import { runRateLabel } from "@/components/dashboard/runStatus";
import { useRun } from "@/hooks/queries";

/**
 * The run-context header shown in place of the global top bar on every
 * `/runs/:runId/*` screen (design frame A2, `.rctx`). It keeps the active run
 * and its pipeline stage always visible: run avatar · RUN-code / run name ·
 * stage pill · "Switch run" trigger. Switching runs (via {@link RunSwitcher})
 * keeps the user on the same pipeline stage in the newly-selected run.
 */
export function RunContextHeader({ runId }: { runId: number }) {
  const { data: run } = useRun(runId);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const stage = run ? (runStatusToStage[run.status] ?? 1) : 1;

  return (
    <header className="glass-strong flex h-[56px] shrink-0 items-center gap-2.5 rounded-[18px] px-[18px]">
      {run && (
        <>
          <span
            className="flex h-6 w-6 items-center justify-center rounded-[7px]"
            style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)" }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
              <rect x="3" y="4" width="18" height="4" rx="1.2" />
              <rect x="3" y="10" width="18" height="4" rx="1.2" />
            </svg>
          </span>
          <span className="font-mono text-[11.5px] font-semibold" style={{ color: "#67e8f9" }}>
            {run.code}
          </span>
          <span style={{ color: "#4c4c5a" }}>/</span>
          <span className="text-[12.5px] font-semibold text-ink">{run.name}</span>

          <span
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
            style={{
              background: "rgba(139,92,246,.16)",
              color: "#c4b5fd",
              border: "1px solid rgba(139,92,246,.3)",
            }}
          >
            <CheckSquare size={12} strokeWidth={2} />
            {runRateLabel(run.status)} &#183; stage {stage} of 9
          </span>
        </>
      )}

      <button
        ref={btnRef}
        onClick={() => setSwitcherOpen((o) => !o)}
        className="ml-auto flex items-center gap-1.5 rounded-[9px] border border-white/[0.1] bg-white/[0.05] px-[11px] py-1.5 text-[11px] font-semibold text-ink-soft hover:bg-white/[0.09]"
      >
        Switch run <ChevronDown size={12} strokeWidth={2} />
      </button>

      <RunSwitcher
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        anchorRef={btnRef}
        runId={runId}
      />
    </header>
  );
}
