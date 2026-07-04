import { useRunRouteId } from "@/hooks/useRunRouteId";
import { GlobalSidebar } from "./GlobalSidebar";
import { RunSidebar } from "./RunSidebar";

/**
 * Sidebar brancher: inside a `/runs/:runId/*` route the sidebar becomes the
 * run's workspace (pipeline-as-navigation); otherwise it shows global nav only.
 * Run-scoped screens never appear as global nav — that's the bug this fixes.
 */
export function Sidebar() {
  const runId = useRunRouteId();
  return runId != null ? <RunSidebar runId={runId} /> : <GlobalSidebar />;
}
