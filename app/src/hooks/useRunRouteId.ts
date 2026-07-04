import { useLocation } from "react-router-dom";

/**
 * The runId from the current URL when inside a `/runs/:runId/*` route, else null.
 * Unlike the old useResolvedRunId, this NEVER falls back to a "latest run" default —
 * run-scoped chrome must show nothing (or a picker) when no run is in the URL.
 */
export function useRunRouteId(): number | null {
  const { pathname } = useLocation();
  const m = pathname.match(/^\/runs\/(\d+)/);
  return m ? Number(m[1]) : null;
}
