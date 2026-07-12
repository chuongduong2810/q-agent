import { Loader2, LogIn, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import {
  useCaptureProjectAuth,
  useClearProjectAuth,
  useProjectAuth,
  useSettings,
} from "@/hooks/queries";
import type { AuthState } from "@/types/api";

/**
 * Saved manual-login session status for a project. Shows whether a browser
 * session has been captured (with a Clear button) or prompts that a browser will
 * open on the first run. Also lets the operator capture/refresh the login now
 * (opens a headed browser on the host) without starting a run. Rendered only
 * when "Manual login before run" is on.
 *
 * @param projectKey  Project key used for the auth queries/mutations.
 * @param hasBaseUrl  Whether the project has a base URL configured; capture is
 *                    disabled without one (the backend needs a URL to open).
 */
export function ManualLoginStatus({
  projectKey,
  hasBaseUrl,
}: {
  projectKey: string;
  hasBaseUrl: boolean;
}) {
  const { data: auth } = useProjectAuth(projectKey);
  const { data: settings } = useSettings();
  const clear = useClearProjectAuth(projectKey);
  const capture = useCaptureProjectAuth(projectKey);
  return (
    <ManualLoginStatusView
      auth={auth}
      localAgentMode={settings?.executionTarget === "local-agent"}
      capturing={capture.isPending || auth?.capturing === true}
      hasBaseUrl={hasBaseUrl}
      clearing={clear.isPending}
      onCapture={() =>
        capture.mutate(undefined, {
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : "Failed to capture login"),
        })
      }
      onClear={() =>
        clear.mutate(undefined, {
          onSuccess: () => toast.success("Saved login cleared"),
          onError: (err) =>
            toast.error(err instanceof Error ? err.message : "Failed to clear login"),
        })
      }
    />
  );
}

/**
 * Presentational manual-login status card — scope-agnostic. Given the current
 * auth state and capture/clear handlers, renders the "captured / none yet" row
 * with Capture and Clear actions. Owner and shared containers supply the data
 * (fires a one-time toast when a capture we started completes).
 */
export function ManualLoginStatusView({
  auth,
  capturing,
  hasBaseUrl,
  clearing,
  onCapture,
  onClear,
  localAgentMode = false,
}: {
  auth: AuthState | undefined;
  capturing: boolean;
  hasBaseUrl: boolean;
  clearing: boolean;
  onCapture: () => void;
  onClear: () => void;
  /** When execution runs on the Local Agent, login is captured on the operator's
   * OWN machine during the first run — there's no server-side capture, so show
   * guidance instead of the (impossible-here) "Capture login now" button. */
  localAgentMode?: boolean;
}) {
  // Fire a one-time success toast when a capture we started finishes.
  const wasCapturing = useRef(false);
  useEffect(() => {
    if (wasCapturing.current && !capturing && auth?.exists) {
      toast.success("Login captured");
    }
    wasCapturing.current = capturing;
  }, [capturing, auth?.exists]);

  return (
    <div className="mt-3 rounded-[12px] border border-white/[0.08] bg-white/[0.03] p-[13px_15px]">
      <div className="flex flex-wrap items-center gap-3">
        {auth?.exists ? (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#6ee7b7]" />
            <span className="flex-1 text-[12.5px] font-semibold text-ink-soft">
              Saved login captured{" "}
              {auth.capturedAt ? new Date(auth.capturedAt).toLocaleString() : ""}
            </span>
          </>
        ) : (
          <>
            <span className="h-2 w-2 shrink-0 rounded-full bg-[#8b8b9e]" />
            <span className="flex-1 text-[12.5px] text-ink-dim">
              {localAgentMode
                ? "No saved login yet — capture now and a browser opens on your Local Agent, or it opens automatically on the first run."
                : "No saved login yet — capture one now, or a browser will open on the first run."}
            </span>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="glass"
            size="sm"
            onClick={onCapture}
            disabled={capturing || !hasBaseUrl}
            title={hasBaseUrl ? undefined : "Set a base URL first"}
          >
            {capturing ? (
              <>
                <Loader2 size={13} strokeWidth={2.2} className="animate-spin" /> Capturing…
              </>
            ) : (
              <>
                <LogIn size={13} strokeWidth={2.2} /> Capture login now
              </>
            )}
          </Button>
          {auth?.exists && (
            <Button variant="glass" size="sm" onClick={onClear} disabled={clearing}>
              <Trash2 size={13} strokeWidth={2.2} />{" "}
              {clearing ? "Clearing…" : "Clear saved login"}
            </Button>
          )}
        </div>
      </div>
      {capturing && (
        <p className="mt-2.5 text-[12px] leading-relaxed text-ink-dim">
          {localAgentMode
            ? "A browser is opening on your Local Agent — log in there, then close the window to finish."
            : "A browser opened on this machine — log in, then close the window to finish."}
        </p>
      )}
    </div>
  );
}
