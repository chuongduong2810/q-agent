import { useLocation } from "react-router-dom";
import { useRuns } from "@/hooks/queries";

/**
 * Resolve the "current run" id for shell chrome (sidebar run-scoped items, the
 * top-bar run chip, run-scoped palette commands) that need a target run even
 * when the URL isn't a run route.
 *
 * Resolution order (matches the old `App.tsx` default-run behaviour):
 *   1. the `:runId` in the URL when inside a `/runs/:id` route,
 *   2. else the most-recent non-done run from the runs query,
 *   3. else the first run.
 *
 * `:runId` is parsed from `useLocation().pathname` rather than `useParams`
 * because this hook is used above the run route segment (in the shell), where
 * `useParams` cannot see it.
 */
export function useResolvedRunId(): number | null {
  const { pathname } = useLocation();
  const { data: runs } = useRuns();

  const match = pathname.match(/^\/runs\/(\d+)/);
  if (match) return Number(match[1]);

  if (runs && runs.length) {
    const active = runs.find((r) => r.status !== "done") ?? runs[0];
    return active.id;
  }
  return null;
}
