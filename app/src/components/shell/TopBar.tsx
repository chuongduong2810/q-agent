import { Plus, Search } from "lucide-react";
import { AiActivityIndicator } from "@/components/shell/AiActivityIndicator";
import { ClaudeStatsButton } from "@/components/shell/ClaudeStatsButton";
import { ProjectStatusButton } from "@/components/shell/ProjectStatusButton";
import { RunContextHeader } from "@/components/shell/RunContextHeader";
import { useRunRouteId } from "@/hooks/useRunRouteId";
import { useUI } from "@/store/ui";

export function TopBar() {
  const openPalette = useUI((s) => s.openPalette);
  const openCreateRun = useUI((s) => s.openCreateRun);
  const runId = useRunRouteId();

  // On a run-scoped screen the global bar is replaced by the run-context header.
  if (runId != null) return <RunContextHeader runId={runId} />;

  return (
    <header className="glass-strong flex h-[56px] shrink-0 items-center gap-3.5 rounded-[18px] px-[18px]">
      <button
        data-tour="topbar-search"
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
        <ProjectStatusButton />
        <ClaudeStatsButton />
        <button
          data-tour="topbar-newrun"
          onClick={openCreateRun}
          className="accent-gradient flex h-[38px] items-center gap-2 rounded-xl px-4 text-[13px] font-semibold text-white shadow-[0_8px_22px_-8px_rgba(139,92,246,.8)] hover:brightness-110"
        >
          <Plus size={15} strokeWidth={2.4} /> New Run
        </button>
      </div>
    </header>
  );
}
