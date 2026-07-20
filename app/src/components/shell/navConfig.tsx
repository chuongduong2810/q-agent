import {
  BarChart3,
  Boxes,
  FolderKanban,
  GraduationCap,
  LayoutDashboard,
  Laptop,
  Settings,
  ShieldCheck,
  SquareStack,
  Ticket,
  Users,
  type LucideProps,
} from "lucide-react";
import { type ComponentType } from "react";

/**
 * Shared navigation definitions for the app shell. The desktop `GlobalSidebar`,
 * the desktop `RunSidebar`, and the mobile `MobileDrawer` all render the SAME
 * routes — this module is the single source of truth for the nav groups so the
 * three presentations can never drift. (Extracted from GlobalSidebar/RunSidebar
 * when the mobile drawer was added.)
 */
export interface NavItem {
  path: string;
  /** English source label — kept for the stable `data-tour` id and as fallback. */
  label: string;
  /** i18n key into the `nav` namespace (`items.<key>`); see ADR 0011. */
  key: string;
  icon: ComponentType<{ size?: number; strokeWidth?: number }>;
}

/** Global-only navigation. Run-scoped screens (Review / Automation / … ) never
 * appear here — they exist only inside a run's workspace (see RunSidebar /
 * MobileDrawer in-run mode), which is what prevents opening them without a run. */
export const PRIMARY_NAV: NavItem[] = [
  { path: "/", label: "Dashboard", key: "dashboard", icon: LayoutDashboard },
  { path: "/projects", label: "Projects", key: "projects", icon: FolderKanban },
  { path: "/tickets", label: "Tickets", key: "tickets", icon: Ticket },
  { path: "/runs", label: "Runs", key: "runs", icon: SquareStack },
];

export const SECONDARY_NAV: NavItem[] = [
  { path: "/reports", label: "Reports", key: "reports", icon: BarChart3 },
  { path: "/getting-started", label: "Getting Started", key: "gettingStarted", icon: GraduationCap },
  { path: "/local-agent", label: "Local Agent", key: "localAgent", icon: Laptop },
  { path: "/settings", label: "Settings", key: "settings", icon: Settings },
];

/** Claude credentials nav icon — the Claude sunburst as a monochrome *stroked*
 * line icon (`currentColor`), matching the design's nav treatment and the other
 * line icons in the rail. NOT the filled brand-orange `ClaudeLogo`. */
export const ClaudeNavIcon = ({ size = 18, strokeWidth = 2 }: LucideProps) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2.4l2.6 6.6 6.9.4-5.3 4.4 1.8 6.7L12 17.3 6 20.9l1.8-6.7L2.5 9.4l6.9-.4z" />
  </svg>
);

/** Admin-only navigation — rendered in a dedicated, gated ADMIN section. */
export const ADMIN_NAV: NavItem[] = [
  { path: "/settings/users", label: "Users", key: "users", icon: Users },
  { path: "/settings/claude-credentials", label: "Claude credentials", key: "claudeCredentials", icon: ClaudeNavIcon },
  { path: "/settings/shared-workspace", label: "Shared workspace", key: "sharedWorkspace", icon: Boxes },
  { path: "/audit", label: "Audit Log", key: "auditLog", icon: ShieldCheck },
];

/**
 * Pick the ONE nav path that best matches the current URL. The admin pages live
 * UNDER /settings/* (e.g. /settings/claude-credentials), so a naive
 * `startsWith("/settings")` would light up both "Settings" AND the admin item.
 * Instead we pick the item whose path is the *longest* boundary-aware match, so
 * a nested route highlights only its own item — never its ancestor.
 */
export function activeNavPath(items: NavItem[], pathname: string): string | null {
  const matchLength = (path: string): number => {
    if (path === "/") return pathname === "/" ? 0 : -1;
    return pathname === path || pathname.startsWith(`${path}/`) ? path.length : -1;
  };
  return items.reduce<{ path: string | null; len: number }>(
    (best, n) => {
      const len = matchLength(n.path);
      return len > best.len ? { path: n.path, len } : best;
    },
    { path: null, len: -1 },
  ).path;
}

/** The 7 per-run pipeline stages as the run's navigation. `stage` is the 1-based
 * index (see `runStatusToStage`, one per real Run.status) used for done/current
 * styling; `seg` is the run sub-route this step opens (null = non-navigable phase
 * marker). Sync & Select are pre-run setup (Tickets + Create-Run flow), so they
 * are not stages here. Keep in sync with PipelineRail.STAGES + MobileStepperRail. */
export const PIPELINE: { label: string; key: string; stage: number; seg: string | null }[] = [
  { label: "Analyze", key: "analyze", stage: 1, seg: null },
  { label: "Review", key: "review", stage: 2, seg: "review" },
  { label: "Link", key: "link", stage: 3, seg: "sync" },
  { label: "Automation", key: "automation", stage: 4, seg: "automation" },
  { label: "Execution", key: "execution", stage: 5, seg: "execution" },
  { label: "Evidence", key: "evidence", stage: 6, seg: "evidence" },
  { label: "Publish", key: "publish", stage: 7, seg: "comment" },
];

/** Pinned global mini-row shown at the foot of the run workspace nav. */
export const GLOBAL_MINI: NavItem[] = [
  { path: "/", label: "Dashboard", key: "dashboard", icon: LayoutDashboard },
  { path: "/tickets", label: "Tickets", key: "tickets", icon: Ticket },
  { path: "/runs", label: "Runs", key: "runs", icon: SquareStack },
  { path: "/reports", label: "Reports", key: "reports", icon: BarChart3 },
  { path: "/settings", label: "Settings", key: "settings", icon: Settings },
];
