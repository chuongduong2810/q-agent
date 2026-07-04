import {
  BarChart3,
  FolderKanban,
  LayoutDashboard,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareStack,
  Ticket,
  User,
} from "lucide-react";
import type { ComponentType } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { cn } from "@/lib/cn";
import { useSettings } from "@/hooks/queries";

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

/** Global-only navigation. Run-scoped screens (Review / Automation / Execution /
 * Evidence) deliberately never appear here — they exist only inside a run's
 * workspace (see RunSidebar), which is what prevents opening them without a run. */
const PRIMARY_NAV: NavItem[] = [
  { path: "/", label: "Dashboard", icon: LayoutDashboard },
  { path: "/projects", label: "Projects", icon: FolderKanban },
  { path: "/tickets", label: "Tickets", icon: Ticket },
  { path: "/runs", label: "Runs", icon: SquareStack },
];

const SECONDARY_NAV: NavItem[] = [
  { path: "/reports", label: "Reports", icon: BarChart3 },
  { path: "/audit", label: "Audit Log", icon: ShieldCheck },
  { path: "/settings", label: "Settings", icon: Settings },
];

/** The global (non-run) sidebar: brand header, two global nav groups, profile
 * footer. Structurally the pre-split sidebar, minus the run-scoped items. */
export function GlobalSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: settings } = useSettings();
  const userName = (settings?.userName ?? "").trim();
  const userRole = (settings?.userRole ?? "").trim();
  const hasIdentity = userName.length > 0;

  const isActive = (path: string): boolean =>
    path === "/" ? pathname === "/" : pathname.startsWith(path);

  const renderItem = (n: NavItem) => {
    const active = isActive(n.path);
    const Icon = n.icon;
    return (
      <button
        key={n.path}
        onClick={() => navigate(n.path)}
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
      </button>
    );
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
        {PRIMARY_NAV.map(renderItem)}
        <hr className="mx-1.5 my-2 border-0 border-t border-white/[0.06]" />
        {SECONDARY_NAV.map(renderItem)}
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
