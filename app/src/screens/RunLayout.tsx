import { Navigate, Outlet, useParams } from "react-router-dom";
import { RunSocketProvider } from "@/hooks/useRunEvents";

/**
 * Layout for every run-scoped route (`/runs/:runId/*`). Coerces `:runId` to a
 * number and mounts the single run WebSocket via `RunSocketProvider`, which
 * persists across intra-run navigation. Invalid ids fall back to the runs list.
 */
export function RunLayout() {
  const { runId } = useParams();
  const id = Number(runId);

  if (Number.isNaN(id)) return <Navigate to="/runs" replace />;

  return (
    <RunSocketProvider runId={id}>
      <Outlet />
    </RunSocketProvider>
  );
}
