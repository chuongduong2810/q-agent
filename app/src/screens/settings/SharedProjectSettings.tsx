/**
 * Admin "Shared project settings" page (ADR 0009 §2). The full, Projects-style
 * settings form for a single shared-namespace project (`owner_id IS NULL`),
 * reachable from the Shared workspace list. Reuses `ProjectSettingsForm` and the
 * manual-login view from `ProjectDetail`, but wired to the shared endpoints so an
 * admin configures the shared project (base URL, connections, repos, test
 * accounts, environments, extra, manual login) that members clone. Gated to
 * `role === "admin"`.
 */

import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ProjectSettingsForm, ManualLoginStatusView } from "@/screens/ProjectDetail";
import {
  useCaptureSharedProjectAuth,
  useClearSharedProjectAuth,
  useCreateSharedProject,
  useSharedProjectAuth,
  useSharedProjectConfig,
} from "@/hooks/queries";
import { useAuth } from "@/store/auth";

export function SharedProjectSettings() {
  const { key = "" } = useParams();
  const navigate = useNavigate();
  const me = useAuth((s) => s.user);
  const { data: config, isLoading } = useSharedProjectConfig(key);
  const save = useCreateSharedProject();

  if (me && me.role !== "admin") {
    return (
      <div className="mx-auto flex max-w-[560px] flex-col items-center py-24 text-center">
        <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03]">
          <Lock size={26} className="text-[#8b8b9e]" />
        </div>
        <h1 className="m-0 mb-2 text-[22px] font-black tracking-[-0.02em]">Not authorized</h1>
        <p className="m-0 max-w-[380px] text-[13.5px] leading-relaxed text-muted">
          The shared workspace is managed by workspace administrators only.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[940px] py-10">
      <button
        onClick={() => navigate("/settings/shared-workspace")}
        className="mb-4 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} strokeWidth={2.4} /> Shared workspace
      </button>
      <div className="mb-[22px]">
        <div className="mb-[5px] flex items-center gap-2 text-[13px] font-medium text-muted">
          <span className="rounded-full bg-[rgba(139,92,246,.16)] px-[7px] py-[2px] text-[9px] font-bold tracking-[.06em] text-[#c4b5fd]">
            ADMIN
          </span>
          Shared project
        </div>
        <h1 className="m-0 text-[28px] font-black tracking-[-0.03em]">{config?.name || key}</h1>
        <p className="mt-1.5 text-[13px] text-muted">
          Settings members inherit when they clone. Connections here are used only to build shared
          knowledge — they are dropped on clone, so members re-bind their own.
        </p>
      </div>

      {isLoading || !config ? (
        <div className="glass rounded-[18px] p-8 text-center text-[13px] text-ink-dim">Loading…</div>
      ) : (
        <ProjectSettingsForm
          config={config}
          saving={save.isPending}
          onSave={(patch) =>
            save.mutate(
              { key, body: patch },
              {
                onSuccess: () => toast.success("Shared project settings saved"),
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : "Save failed"),
              },
            )
          }
          renderManualLogin={(hasBaseUrl) => (
            <SharedManualLoginStatus projectKey={key} hasBaseUrl={hasBaseUrl} />
          )}
        />
      )}
    </div>
  );
}

/** Shared-scope container for the manual-login card — wires the presentational
 * `ManualLoginStatusView` to the shared project's auth endpoints. */
function SharedManualLoginStatus({
  projectKey,
  hasBaseUrl,
}: {
  projectKey: string;
  hasBaseUrl: boolean;
}) {
  const { data: auth } = useSharedProjectAuth(projectKey);
  const clear = useClearSharedProjectAuth(projectKey);
  const capture = useCaptureSharedProjectAuth(projectKey);
  return (
    <ManualLoginStatusView
      auth={auth}
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
          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to clear login"),
        })
      }
    />
  );
}
