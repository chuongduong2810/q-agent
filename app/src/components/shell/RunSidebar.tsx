import {
  ArrowLeft,
  BarChart3,
  Check,
  ChevronsUpDown,
  LayoutDashboard,
  Settings,
  SquareStack,
  Ticket,
} from "lucide-react";
import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { runColor, runRateLabel } from "@/components/dashboard/runStatus";
import { runStatusToStage } from "@/components/ui/PipelineRail";
import { useRun } from "@/hooks/queries";
import { useUI } from "@/store/ui";

/** Pipeline stages as the run's navigation. `stage` is the 1-based index in the
 * global pipeline (see `runStatusToStage`) used for done/current styling; `seg`
 * is the run sub-route this step opens (null = non-navigable phase marker). */
const PIPELINE: { label: string; stage: number; seg: string | null }[] = [
  { label: "Sync & Select", stage: 2, seg: null },
  { label: "Analyze", stage: 3, seg: null },
  { label: "Review", stage: 4, seg: "review" },
  { label: "Link", stage: 5, seg: "sync" },
  { label: "Automation", stage: 6, seg: "automation" },
  { label: "Execution", stage: 7, seg: "execution" },
  { label: "Evidence", stage: 8, seg: "evidence" },
  { label: "Publish", stage: 9, seg: "comment" },
];

interface MiniItem {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

const GLOBAL_MINI: MiniItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/tickets", label: "Tickets", icon: Ticket },
  { path: "/runs", label: "Runs", icon: SquareStack },
  { path: "/reports", label: "Reports", icon: BarChart3 },
  { path: "/settings", label: "Settings", icon: Settings },
];

/**
 * Workspace-mode sidebar shown while inside a run (`/runs/:runId/*`). The whole
 * sidebar becomes the run: an "All of Q-Agent" exit, a run identity card with a
 * switcher, the pipeline-as-navigation, and a pinned global mini-row. Run-scoped
 * screens are reachable only from here, so they can't be opened without a run.
 */
export function RunSidebar({ runId }: { runId: number }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: run } = useRun(runId);
  const openRunSwitcher = useUI((s) => s.openRunSwitcher);

  // Current URL sub-segment (`review` | `sync` | … ), null on the run index.
  const urlSeg = pathname.match(/^\/runs\/\d+(?:\/(\w+))?/)?.[1] ?? null;
  // 1-based pipeline stage the run is currently at, from its status.
  const currentStage = run ? runStatusToStage[run.status] ?? 0 : 0;
  const accent = run ? runColor(run.status) : "#a0a0b2";

  return (
    <aside className="glass-strong flex w-[248px] shrink-0 flex-col rounded-[22px] p-[20px_14px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)]">
      <button
        onClick={() => navigate("/")}
        className="mb-3 flex items-center gap-2.5 rounded-[10px] border border-white/[0.08] bg-white/[0.04] px-2.5 py-[7px] text-left text-[11.5px] font-semibold text-ink-dim transition-colors hover:bg-white/[0.07]"
      >
        <ArrowLeft size={14} strokeWidth={2} />
        All of Q&#8209;Agent
      </button>

      <div
        className="relative mb-1.5 rounded-[13px] p-3"
        style={{
          background:
            "linear-gradient(135deg,rgba(139,92,246,.18),rgba(99,102,241,.08))",
          border: "1px solid rgba(139,92,246,.3)",
        }}
      >
        <div className="mb-1.5 flex items-center gap-2">
          <span className="font-mono text-[10.5px] font-bold text-[#c4b5fd]">
            {run?.code ?? `RUN-${runId}`}
          </span>
          {run && (
            <span
              className="rounded-full px-2 py-0.5 text-[9.5px] font-bold"
              style={{
                background: `${accent}2e`,
                color: accent,
              }}
            >
              {runRateLabel(run.status)}
            </span>
          )}
        </div>
        <div className="text-[13px] font-extrabold leading-[1.25] tracking-tight">
          {run?.name ?? "Loading run…"}
        </div>
        {run && (
          <div className="mt-[5px] text-[10px] text-[#b9a8e6]">
            {run.ticketIds.length} tickets · {run.framework} · {run.env}
          </div>
        )}
        <button
          onClick={openRunSwitcher}
          title="Switch run"
          className="absolute right-2.5 top-2.5 flex h-[22px] w-[22px] items-center justify-center rounded-[7px] bg-white/[0.08] text-[#c7c7d4] transition-colors hover:bg-white/[0.16]"
        >
          <ChevronsUpDown size={13} strokeWidth={2} />
        </button>
      </div>

      <div className="px-2 pb-1.5 pt-2 text-[10px] font-semibold tracking-[0.11em] text-[#5c5c6e]">
        PIPELINE
      </div>

      <nav className="relative flex flex-col gap-px overflow-y-auto py-1.5">
        {/* connector rail behind the nodes (node center ≈ 18px from the left) */}
        <div className="absolute bottom-5 left-[18px] top-5 w-0.5 bg-white/[0.09]" />
        {PIPELINE.map((step, i) => {
          const done = currentStage > 0 && step.stage < currentStage;
          const isCurrent = step.stage === currentStage;
          const activeUrl = step.seg != null && step.seg === urlSeg;
          const clickable = step.seg != null;
          const emphasized = isCurrent || activeUrl;

          const node = (
            <span
              className="relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full font-mono text-[9.5px] font-bold"
              style={{
                background: done
                  ? "#10b981"
                  : emphasized
                    ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                    : "#12121a",
                border: done || emphasized ? "1px solid transparent" : "1px solid rgba(255,255,255,.14)",
                color: done || emphasized ? "#fff" : "#7a7a8c",
                boxShadow: emphasized ? "0 0 0 4px rgba(139,92,246,.2)" : undefined,
              }}
            >
              {done ? <Check size={11} strokeWidth={3} /> : i + 1}
            </span>
          );

          const label = (
            <span
              className="flex-1 text-[12px] font-semibold"
              style={{
                color: activeUrl || isCurrent
                  ? "#fff"
                  : done
                    ? "#b4b4c2"
                    : clickable
                      ? "#c7c7d4"
                      : "#8b8b9e",
              }}
            >
              {step.label}
            </span>
          );

          const tag = clickable && (
            <span
              className="rounded-[5px] border px-1.5 py-px text-[8.5px] font-semibold tracking-[0.05em]"
              style={{
                color: emphasized ? "#c4b5fd" : "#6c6c7e",
                borderColor: emphasized ? "rgba(139,92,246,.4)" : "rgba(255,255,255,.1)",
              }}
            >
              screen
            </span>
          );

          const stepClass = cn(
            "flex items-center gap-[11px] rounded-[9px] px-2 py-[5px] text-left",
            clickable && !activeUrl && "hover:bg-white/[0.05]",
          );
          const stepStyle = activeUrl
            ? {
                background:
                  "linear-gradient(135deg,rgba(139,92,246,.2),rgba(99,102,241,.1))",
                boxShadow: "inset 0 0 0 1px rgba(139,92,246,.28)",
              }
            : undefined;

          return clickable ? (
            <button
              key={step.label}
              onClick={() => navigate(`/runs/${runId}/${step.seg}`)}
              className={cn(stepClass, "w-full border-none")}
              style={stepStyle}
            >
              {node}
              {label}
              {tag}
            </button>
          ) : (
            <div key={step.label} className={stepClass} style={stepStyle}>
              {node}
              {label}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto border-t border-white/[0.06] pt-2.5">
        <div className="px-2 pb-1.5 text-[10px] font-semibold tracking-[0.11em] text-[#5c5c6e]">
          GLOBAL
        </div>
        <div className="flex gap-1.5 px-1">
          {GLOBAL_MINI.map((m) => {
            const Icon = m.icon;
            return (
              <button
                key={m.path}
                onClick={() => navigate(m.path)}
                title={m.label}
                className="flex h-[30px] flex-1 items-center justify-center rounded-[9px] bg-white/[0.04] text-[#8b8b9e] transition-colors hover:bg-white/[0.08] hover:text-white"
              >
                <Icon size={15} strokeWidth={2} />
              </button>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
