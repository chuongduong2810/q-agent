import { useEffect } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { RedirectLoader } from "@/components/auth/AuthLayout";

/**
 * Auth guard for the entire authenticated app subtree (ADR 0007), modeled on
 * `RunLayout`. On first mount (store `status === "idle"`) it kicks off
 * `bootstrap()`, which exchanges the httpOnly refresh cookie for an access
 * token. While idle/loading it shows the full-screen `RedirectLoader`; on a
 * dead session it redirects to `/login`; once authed it renders the app shell
 * via `<Outlet/>`.
 */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);

  if (status === "idle" || status === "loading") return <RedirectLoader />;
  if (status === "anon") return <Navigate to="/login" replace />;

  return <Outlet />;
}
