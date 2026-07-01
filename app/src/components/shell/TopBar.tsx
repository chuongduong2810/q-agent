import { ChevronDown, Plus, Search } from "lucide-react";
import { AiActivityIndicator } from "@/components/shell/AiActivityIndicator";
import { useRuns } from "@/hooks/queries";
import { useUI } from "@/store/ui";

export function TopBar() {
  const activeProject = useUI((s) => s.activeProject);
  const activeRunId = useUI((s) => s.activeRunId);
  const navigate = useUI((s) => s.navigate);
  const openPalette = useUI((s) => s.openPalette);
  const openCreateRun = useUI((s) => s.openCreateRun);
  const { data: runs } = useRuns();

  const activeRun = runs?.find((r) => r.id === activeRunId) ?? runs?.[0];
  const isLive = activeRun && activeRun.status !== "done";

  return (
    <header className="glass-strong flex h-[56px] shrink-0 items-center gap-3.5 rounded-[18px] px-[18px]">
      <button
        onClick={() => navigate("projects")}
        className="flex items-center gap-2.5 rounded-xl border border-white/[0.08] bg-white/[0.05] px-3 py-[7px] hover:bg-white/[0.09]"
      >
        <div
          className="h-5 w-5 rounded-md"
          style={{ background: "linear-gradient(135deg,#22d3ee,#6366f1)" }}
        />
        <span className="text-[13px] font-semibold text-ink">{activeProject}</span>
        <ChevronDown size={14} color="#8a8a9c" strokeWidth={2} />
      </button>

      <button
        onClick={openPalette}
        className="flex h-[38px] max-w-[420px] flex-1 cursor-text items-center gap-2.5 rounded-xl border border-white/[0.07] bg-white/[0.04] px-3.5 text-[#7a7a8c] hover:border-[rgba(139,92,246,.4)]"
      >
        <Search size={15} strokeWidth={2} />
        <span className="flex-1 text-left text-[13px]">Search or ask Q&#8209;Agent anything&#8230;</span>
        <span className="rounded-md border border-white/[0.08] bg-white/[0.06] px-[7px] py-0.5 font-mono text-[11px]">
          &#8984;K
        </span>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <AiActivityIndicator />
        {activeRun && (
          <button
            onClick={() => navigate("run")}
            className="flex h-[38px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3.5 text-[13px] font-semibold text-ink-soft hover:bg-white/[0.09]"
          >
            {isLive && (
              <span
                className="h-[7px] w-[7px] rounded-full"
                style={{ background: "#f59e0b", animation: "pulseDot 1.6s infinite" }}
              />
            )}
            {activeRun.code}
          </button>
        )}
        <button
          onClick={openCreateRun}
          className="accent-gradient flex h-[38px] items-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(139,92,246,.8)] hover:brightness-110"
        >
          <Plus size={15} strokeWidth={2.4} /> New Run
        </button>
      </div>
    </header>
  );
}
