import { AnimatePresence, motion } from "framer-motion";
import { RotateCcw, Square, Trash2, X } from "lucide-react";
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "@/lib/toast";
import { isTerminalRun } from "@/components/dashboard/runStatus";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useCancelRun, useDeleteRun, useRetryRun } from "@/hooks/queries";
import type { RunOut } from "@/types/api";

/**
 * Floating bulk-action bar for the Runs list. Appears (animated up from the
 * bottom) whenever one or more runs are selected. Actions apply to the eligible
 * subset of the selection — retry only terminal runs, cancel only in-progress
 * ones — and report what was skipped. Portalled to `document.body` per the
 * floating-overlay rule.
 */
export function RunBulkBar({
  selected,
  onClear,
}: {
  selected: RunOut[];
  onClear: () => void;
}) {
  const cancelRun = useCancelRun();
  const retryRun = useRetryRun();
  const deleteRun = useDeleteRun();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const count = selected.length;
  const terminal = selected.filter((r) => isTerminalRun(r.status));
  const inProgress = selected.filter((r) => !isTerminalRun(r.status));

  const runBulk = async (
    rows: RunOut[],
    fn: (id: number) => Promise<unknown>,
    verb: string,
    skipped: number,
  ) => {
    if (!rows.length) {
      toast.error(`No ${verb === "Retried" ? "terminal" : "in-progress"} runs selected`);
      return;
    }
    setBusy(true);
    const results = await Promise.allSettled(rows.map((r) => fn(r.id)));
    setBusy(false);
    const ok = results.filter((r) => r.status === "fulfilled").length;
    const failed = results.length - ok;
    toast.success(
      `${verb} ${ok} run${ok === 1 ? "" : "s"}` +
        (failed ? `, ${failed} failed` : "") +
        (skipped ? `, ${skipped} skipped` : ""),
    );
    onClear();
  };

  const handleRetry = () =>
    runBulk(terminal, (id) => retryRun.mutateAsync(id), "Retried", inProgress.length);
  const handleCancel = () =>
    runBulk(inProgress, (id) => cancelRun.mutateAsync(id), "Cancelled", terminal.length);

  const handleDelete = async () => {
    // Only terminal runs can be deleted; in-progress ones 409 (cancel first).
    setConfirmingDelete(false);
    await runBulk(terminal, (id) => deleteRun.mutateAsync(id), "Deleted", inProgress.length);
  };

  return createPortal(
    <>
      <AnimatePresence>
        {count > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 90, x: "-50%" }}
            animate={{ opacity: 1, y: 0, x: "-50%" }}
            exit={{ opacity: 0, y: 90, x: "-50%" }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}
            className="fixed bottom-6 left-1/2 z-[900] flex items-center gap-1 rounded-[16px] border border-white/[0.12] py-2 pl-2 pr-2.5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.85)]"
            style={{ background: "rgb(26,26,34)" }}
          >
            <span className="mr-1 flex items-center gap-2 rounded-[11px] bg-[rgba(139,92,246,.18)] py-1.5 pl-2 pr-3 text-[12.5px] font-semibold text-ink">
              <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet px-1.5 text-[11px] font-bold text-white">
                {count}
              </span>
              selected
            </span>
            <BulkBtn title="Retry selected" onClick={handleRetry} disabled={busy}>
              <RotateCcw size={16} strokeWidth={2} />
            </BulkBtn>
            <BulkBtn title="Cancel selected" onClick={handleCancel} disabled={busy}>
              <Square size={15} strokeWidth={2.2} />
            </BulkBtn>
            <BulkBtn
              title="Delete selected"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy}
              danger
            >
              <Trash2 size={16} strokeWidth={2} />
            </BulkBtn>
            <div className="mx-0.5 h-6 w-px bg-white/[0.1]" />
            <BulkBtn title="Clear selection" onClick={onClear} disabled={busy}>
              <X size={16} strokeWidth={2} />
            </BulkBtn>
          </motion.div>
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete ${terminal.length} run${terminal.length === 1 ? "" : "s"}?`}
        message={
          `The selected run${terminal.length === 1 ? "" : "s"} and all of their test cases, ` +
          `executions, and evidence will be permanently deleted.` +
          (inProgress.length
            ? ` ${inProgress.length} in-progress run${inProgress.length === 1 ? "" : "s"} will be skipped — cancel ${inProgress.length === 1 ? "it" : "them"} first.`
            : "")
        }
        confirmLabel="Delete runs"
        danger
        loading={busy}
        onConfirm={handleDelete}
        onClose={() => setConfirmingDelete(false)}
      />
    </>,
    document.body,
  );
}

function BulkBtn({
  children,
  title,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-9 w-9 items-center justify-center rounded-[11px] transition-colors disabled:opacity-40 ${
        danger
          ? "text-[#fb7185] hover:bg-[rgba(251,113,133,.14)]"
          : "text-ink-soft hover:bg-white/[0.08] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
