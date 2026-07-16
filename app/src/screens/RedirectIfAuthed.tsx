import { useEffect, useRef } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/store/auth";
import { RedirectLoader } from "@/components/auth/AuthLayout";

/**
 * Inverse of `RequireAuth` (ADR 0007): guards the PUBLIC sign-in routes
 * (`/login`, `/forgot`) so an already-authenticated visitor can't sit on them.
 * On first mount (store `status === "idle"`) it bootstraps the session from the
 * refresh cookie — this covers a hard load / typed URL while a live session
 * exists. While idle/loading it shows the `RedirectLoader`; an authed visitor is
 * bounced to the workspace root; otherwise the auth screen renders via
 * `<Outlet/>`.
 *
 * NOT applied to `/signed-out`: logout intentionally lands there while still
 * `authed` and clears the session on mount — guarding it would bounce the user
 * back into the app.
 *
 * The `arrivedAnon` latch keeps this guard from hijacking an in-progress login:
 * once we've seen the visitor arrive unauthenticated we let them use the auth
 * screen even after they sign in here, so `Login` keeps ownership of its own
 * post-login navigation + redirect animation (the anon→authed transition from
 * logging in on this very page must not trigger our redirect).
 */
export function RedirectIfAuthed() {
  const status = useAuth((s) => s.status);
  const bootstrap = useAuth((s) => s.bootstrap);

  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [status, bootstrap]);

  const arrivedAnon = useRef(false);
  if (status === "anon") arrivedAnon.current = true;

  if (status === "idle" || status === "loading") return <RedirectLoader />;
  if (status === "authed" && !arrivedAnon.current) return <Navigate to="/" replace />;

  return <Outlet />;
}
