import { useNavigate } from "react-router-dom";
import { api, markLoggingOut } from "@/lib/api";

/**
 * Sign the current user out. Suppresses the api 401 interceptor's redirect to
 * /login so in-flight authenticated requests that 401 after logout don't beat
 * us to /signed-out, then navigates to the public /signed-out route while still
 * "authed" (so RequireAuth stays satisfied and simply unmounts) and revokes the
 * session server-side. SignedOut clears the local session on mount, so the
 * client session is cleared even if the revoke call fails.
 *
 * Shared by the desktop `GlobalSidebar` account menu and the mobile drawer.
 */
export function useLogout(): () => void {
  const navigate = useNavigate();
  return () => {
    markLoggingOut();
    navigate("/signed-out", { replace: true });
    void api.auth.logout().catch(() => {
      // Session is cleared locally by SignedOut even if the revoke call fails.
    });
  };
}
