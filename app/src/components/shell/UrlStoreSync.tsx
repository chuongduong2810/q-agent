import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useRuns } from "@/hooks/queries";
import { useUI, type ProjectTab } from "@/store/ui";
import type { Screen } from "@/types";

/**
 * Temporary bridge (see ADR 0003): mirrors the URL back into the retained legacy
 * Zustand nav fields (`screen`, `activeProject`, `activeTicket`, `activeRunId`,
 * `projectTab`) so screens not yet migrated to native router hooks keep working
 * — deep-linking, refresh and back/forward stay functional after the foundation
 * slice alone. Removed once every screen reads params directly.
 */

/** Run sub-segment → legacy Screen. */
const RUN_SEGMENT_SCREEN: Record<string, Screen> = {
  review: "review",
  sync: "sync",
  automation: "automation",
  execution: "console",
  evidence: "evidence",
  comment: "comment",
};

/** Best-effort map of a pathname to the legacy `screen` value. */
function pathToScreen(pathname: string): Screen {
  if (pathname === "/") return "dashboard";
  if (pathname.startsWith("/projects/")) return "project";
  if (pathname.startsWith("/projects")) return "projects";
  if (pathname.startsWith("/tickets/")) return "ticket";
  if (pathname.startsWith("/tickets")) return "tickets";
  if (pathname.startsWith("/reports")) return "reports";
  if (pathname.startsWith("/audit")) return "audit";
  if (pathname.startsWith("/settings")) return "settings";
  const run = pathname.match(/^\/runs\/\d+(?:\/(\w+))?/);
  if (run) return run[1] ? (RUN_SEGMENT_SCREEN[run[1]] ?? "run") : "run";
  return "runs";
}

export function UrlStoreSync() {
  const location = useLocation();
  const { data: runs } = useRuns();
  const setActiveRun = useUI((s) => s.setActiveRun);

  // Mirror the current URL into the legacy fields on every navigation.
  useEffect(() => {
    const { pathname, search } = location;
    const proj = pathname.match(/^\/projects\/([^/]+)/);
    const tick = pathname.match(/^\/tickets\/([^/]+)/);
    const run = pathname.match(/^\/runs\/(\d+)/);
    const tab = new URLSearchParams(search).get("tab");

    useUI.setState({
      screen: pathToScreen(pathname),
      ...(proj ? { activeProject: decodeURIComponent(proj[1]) } : {}),
      ...(tick ? { activeTicket: decodeURIComponent(tick[1]) } : {}),
      ...(run ? { activeRunId: Number(run[1]) } : {}),
      ...(proj && tab ? { projectTab: tab as ProjectTab } : {}),
    });
  }, [location.pathname, location.search]);

  // Default the "active run" to the in-progress (or most recent) run once runs
  // load and the URL hasn't already pinned one — carried over from App.tsx.
  useEffect(() => {
    if (useUI.getState().activeRunId == null && runs && runs.length) {
      const active = runs.find((r) => r.status !== "done") ?? runs[0];
      setActiveRun(active.id);
    }
  }, [runs, setActiveRun]);

  return null;
}
