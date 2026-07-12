import { Menu, Plus, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { AiActivityIndicator } from "@/components/shell/AiActivityIndicator";
import { useRunRouteId } from "@/hooks/useRunRouteId";
import { useRun } from "@/hooks/queries";
import { useUI } from "@/store/ui";

/** Stage title for each in-run sub-route (null seg = the run index/overview). */
const RUN_STAGE_TITLE: Record<string, string> = {
  "": "Run overview",
  review: "Review Center",
  sync: "Sync",
  automation: "Automation",
  execution: "Execution",
  evidence: "Evidence",
  comment: "Publish",
};

/** Title + subtitle for a global (non-run) route. */
function globalTitle(pathname: string): { title: string; subtitle: string } {
  const map: [RegExp, string, string][] = [
    [/^\/$/, "Dashboard", "Mission control"],
    [/^\/projects\/[^/]+/, "Project", "Project detail"],
    [/^\/projects/, "Projects", "Workspaces"],
    [/^\/tickets\/[^/]+/, "Ticket", "Ticket detail"],
    [/^\/tickets/, "Tickets", "Backlog"],
    [/^\/runs/, "Runs", "QA runs"],
    [/^\/reports/, "Reports", "Analytics"],
    [/^\/audit/, "Audit Log", "Activity"],
    [/^\/settings\/users/, "Team", "Admin"],
    [/^\/settings\/claude-credentials/, "Claude Credentials", "Admin"],
    [/^\/settings\/shared-workspace/, "Shared Workspace", "Admin"],
    [/^\/settings/, "Settings", "Preferences"],
    [/^\/getting-started/, "Getting Started", "Onboarding"],
    [/^\/local-agent/, "Local Agent", "Runner"],
    [/^\/profile/, "Profile", "Account"],
  ];
  const hit = map.find(([re]) => re.test(pathname));
  return hit ? { title: hit[1], subtitle: hit[2] } : { title: "Q-Agent", subtitle: "" };
}

/**
 * The compact top bar shown below the `md` breakpoint in place of the desktop
 * sidebar + top bar: hamburger (opens the nav drawer) · centered title/subtitle
 * · a single right action. On a global screen the action is "+ new run"; inside
 * a run it becomes "✕ exit run" (back to Dashboard). See MOBILE_SPEC §1a.
 */
export function MobileTopBar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const runId = useRunRouteId();
  const { data: run } = useRun(runId ?? null);
  const openDrawer = useUI((s) => s.openDrawer);
  const openCreateRun = useUI((s) => s.openCreateRun);

  const inRun = runId != null;
  const seg = pathname.match(/^\/runs\/\d+(?:\/(\w+))?/)?.[1] ?? "";
  const title = inRun ? (RUN_STAGE_TITLE[seg] ?? "Run") : globalTitle(pathname).title;
  const subtitle = inRun
    ? run
      ? `${run.code} · ${run.name}`
      : "Loading run…"
    : globalTitle(pathname).subtitle;

  return (
    <header
      className="glass-strong z-20 flex shrink-0 items-center gap-3 rounded-[16px] px-3.5 py-2.5"
    >
      <button
        onClick={openDrawer}
        aria-label="Open navigation"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-ink-soft transition-colors active:bg-white/[0.12]"
      >
        <Menu size={19} strokeWidth={2.1} />
      </button>

      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-[15.5px] font-extrabold tracking-tight">{title}</div>
        {subtitle && <div className="truncate text-[10.5px] font-medium text-[#7a7a8c]">{subtitle}</div>}
      </div>

      <AiActivityIndicator />

      {inRun ? (
        <button
          onClick={() => navigate("/")}
          aria-label="Exit run"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.05] text-[#c7c7d4] transition-colors active:bg-white/[0.12]"
        >
          <X size={18} strokeWidth={2.2} />
        </button>
      ) : (
        <button
          onClick={openCreateRun}
          aria-label="New run"
          className="accent-gradient flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white shadow-[0_6px_16px_-5px_rgba(139,92,246,.7)] active:brightness-110"
        >
          <Plus size={19} strokeWidth={2.4} />
        </button>
      )}
    </header>
  );
}
