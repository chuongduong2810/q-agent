import {
  BarChart3,
  CheckSquare,
  FolderKanban,
  Image,
  LayoutDashboard,
  ListChecks,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Terminal,
  Ticket,
  User,
} from "lucide-react";
import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useSettings } from "@/hooks/queries";
import { useResolvedRunId } from "@/hooks/useResolvedRunId";
import type { Screen } from "@/types";

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

interface NavItem {
  id: Screen;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
  badge?: string;
}

const NAV: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "projects", label: "Projects", icon: FolderKanban },
  { id: "tickets", label: "Tickets", icon: Ticket },
  { id: "runs", label: "Runs", icon: SquareStack },
  { id: "review", label: "Review Center", icon: CheckSquare },
  { id: "automation", label: "Automation", icon: Terminal },
  { id: "console", label: "Execution", icon: ListChecks },
  { id: "evidence", label: "Evidence", icon: Image },
  { id: "reports", label: "Reports", icon: BarChart3 },
  { id: "audit", label: "Audit Log", icon: ShieldCheck },
  { id: "settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const runId = useResolvedRunId();
  const { data: settings } = useSettings();
  const userName = (settings?.userName ?? "").trim();
  const userRole = (settings?.userRole ?? "").trim();
  const hasIdentity = userName.length > 0;

  // The run sub-segment (`review` | `automation` | `execution` | …) if inside a run.
  const runSeg = pathname.match(/^\/runs\/\d+(?:\/(\w+))?/);

  const pathFor = (id: Screen): string => {
    switch (id) {
      case "dashboard":
        return "/";
      case "review":
        return runId != null ? `/runs/${runId}/review` : "/runs";
      case "automation":
        return runId != null ? `/runs/${runId}/automation` : "/runs";
      case "console":
        return runId != null ? `/runs/${runId}/execution` : "/runs";
      case "evidence":
        return runId != null ? `/runs/${runId}/evidence` : "/runs";
      default:
        return `/${id}`;
    }
  };

  const isActive = (id: Screen): boolean => {
    switch (id) {
      case "dashboard":
        return pathname === "/";
      case "runs":
        return pathname === "/runs" || (!!runSeg && !runSeg[1]);
      case "review":
        return !!runSeg && (runSeg[1] === "review" || runSeg[1] === "sync");
      case "automation":
        return !!runSeg && runSeg[1] === "automation";
      case "console":
        return !!runSeg && runSeg[1] === "execution";
      case "evidence":
        return !!runSeg && (runSeg[1] === "evidence" || runSeg[1] === "comment");
      default:
        return pathname.startsWith(`/${id}`);
    }
  };

  return (
    <aside className="glass-strong flex w-[248px] shrink-0 flex-col rounded-[22px] p-[20px_14px] shadow-[0_24px_60px_-20px_rgba(0,0,0,.6)]">
      <div className="flex items-center gap-[11px] px-2 pb-[18px] pt-1.5">
        <div className="accent-gradient flex h-[34px] w-[34px] items-center justify-center rounded-[11px] shadow-[0_6px_18px_-4px_rgba(139,92,246,.7)]">
          <Sparkles size={19} color="#fff" strokeWidth={2.2} />
        </div>
        <div>
          <div className="text-[16px] font-black leading-tight tracking-tight">Q&#8209;Agent</div>
          <div className="text-[10.5px] font-medium tracking-[0.04em] text-[#7a7a8c]">
            QA OPERATING SYSTEM
          </div>
        </div>
      </div>

      <div className="px-2.5 pb-2 pt-1 text-[10px] font-semibold tracking-[0.11em] text-[#5c5c6e]">
        WORKSPACE
      </div>

      <nav className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1">
        {NAV.map((n) => {
          const active = isActive(n.id);
          const Icon = n.icon;
          return (
            <button
              key={n.id}
              onClick={() => navigate(pathFor(n.id))}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl border-none px-3 py-[9px] text-left text-[13.5px] font-semibold transition-colors",
                active ? "text-white" : "text-ink-dim hover:bg-white/[0.06]",
              )}
              // Inactive items get no inline background so the `hover:bg-white/[0.06]`
              // class can take effect — an inline `background:transparent` would
              // override the hover rule (inline styles beat :hover classes).
              style={
                active
                  ? {
                      background:
                        "linear-gradient(135deg,rgba(139,92,246,.22),rgba(99,102,241,.12))",
                      boxShadow: "inset 0 0 0 1px rgba(139,92,246,.28)",
                    }
                  : undefined
              }
            >
              <span className="flex w-[18px] justify-center">
                <Icon size={18} strokeWidth={2} />
              </span>
              <span className="flex-1">{n.label}</span>
              {n.badge && (
                <span className="accent-gradient rounded-full px-[7px] py-0.5 text-[10px] font-bold text-white">
                  {n.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto flex flex-col gap-3 pt-3">
        <button
          onClick={() => navigate("/settings")}
          className="flex items-center gap-2.5 rounded-2xl px-2.5 py-1.5 text-left hover:bg-white/[0.05]"
        >
          {hasIdentity ? (
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[10px] text-[13px] font-bold text-white"
              style={{ background: "linear-gradient(135deg,#f59e0b,#f43f5e)" }}
            >
              {initials(userName)}
            </div>
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white/[0.08] text-[#9494a6]">
              <User size={16} strokeWidth={2} />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[12.5px] font-semibold">
              {hasIdentity ? userName : "Set your identity"}
            </div>
            <div className="truncate text-[10.5px] text-[#7a7a8c]">
              {hasIdentity ? userRole || "—" : "Settings → Profile"}
            </div>
          </div>
        </button>
      </div>
    </aside>
  );
}
