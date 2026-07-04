import { Navigate, Outlet, useParams } from "react-router-dom";
import { RunSocketProvider } from "@/hooks/useRunEvents";
import { useRun } from "@/hooks/queries";
import { Spinner } from "@/components/ui/misc";

/**
 * Layout for every run-scoped route (`/runs/:runId/*`). Coerces `:runId` to a
 * number, confirms the run actually exists, and only then mounts the single run
 * WebSocket via `RunSocketProvider` (which persists across intra-run
 * navigation). Invalid or nonexistent (404) run ids fall back to the runs list
 * — the app never auto-selects a run.
 */
export function RunLayout() {
  const id = Number(useParams().runId);
  const valid = !Number.isNaN(id);
  const { data: run, isLoading, isError } = useRun(valid ? id : null);

  // Invalid id or a run that doesn't exist → the run picker (no auto-select).
  if (!valid || isError) return <Navigate to="/runs" replace />;

  // Don't mount the WebSocket until the run is confirmed to exist.
  if (isLoading || !run) {
    return (
      <div className="glass flex flex-1 items-center justify-center rounded-[22px] py-20">
        <Spinner size={22} />
      </div>
    );
  }

  return (
    <RunSocketProvider runId={id}>
      <Outlet />
    </RunSocketProvider>
  );
}
