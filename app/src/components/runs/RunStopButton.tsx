import { Eraser, Square } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "@/lib/toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { isTerminalRun } from "@/components/dashboard/runStatus";
import { useStopRun } from "@/hooks/queries";
import type { RunOut } from "@/types/api";

/**
 * Stop / force-clean-up control for a run (#420/#431). Cancels all of the run's
 * in-flight work — authoring, self-heal, execution, analysis — and resets stuck
 * `running` rows + purges the agent queues. Rendered wherever a run is visible
 * (Runs-list rows AND the in-run context header) so a job started by mistake can
 * be stopped from the screen you're already on, not only the Runs list.
 *
 * In-progress run → red Stop (■): cancel + clean up. Terminal run → amber
 * "force clean up" (🧹): reset orphaned rows without touching the lifecycle
 * status (Retry still keys on `failedStage`).
 */
export function RunStopButton({ run }: { run: RunOut }) {
  const { t } = useTranslation("runs");
  const stopRun = useStopRun();
  const [confirming, setConfirming] = useState(false);
  const terminal = isTerminalRun(run.status);

  const handleStop = () => {
    stopRun.mutate(run.id, {
      onSuccess: () => {
        toast.success(terminal ? t("actions.toast.cleaned") : t("actions.toast.cancelled"));
        setConfirming(false);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : t("actions.toast.cancelFailed")),
    });
  };

  return (
    <>
      <button
        type="button"
        title={terminal ? t("row.cleanupRun") : t("row.stopRun")}
        onClick={(e) => {
          e.stopPropagation();
          setConfirming(true);
        }}
        className={
          terminal
            ? "flex h-8 w-8 items-center justify-center rounded-[9px] bg-[rgba(245,158,11,.16)] text-[#f59e0b] transition-colors hover:bg-[rgba(245,158,11,.28)]"
            : "flex h-8 w-8 items-center justify-center rounded-[9px] bg-[rgba(251,113,133,.16)] text-[#fb7185] transition-colors hover:bg-[rgba(251,113,133,.28)]"
        }
      >
        {terminal ? (
          <Eraser size={14} strokeWidth={2.2} />
        ) : (
          <Square size={13} strokeWidth={2.6} fill="currentColor" />
        )}
      </button>

      <ConfirmDialog
        open={confirming}
        title={terminal ? t("actions.confirmCleanup.title") : t("actions.confirmCancel.title")}
        message={
          terminal
            ? t("actions.confirmCleanup.message", { name: run.name })
            : t("actions.confirmCancel.message", { name: run.name })
        }
        confirmLabel={terminal ? t("actions.confirmCleanup.confirm") : t("actions.confirmCancel.confirm")}
        danger={!terminal}
        loading={stopRun.isPending}
        onConfirm={handleStop}
        onClose={() => setConfirming(false)}
      />
    </>
  );
}
