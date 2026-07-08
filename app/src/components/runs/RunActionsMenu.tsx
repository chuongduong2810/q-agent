import { AnimatePresence, motion } from "framer-motion";
import { MoreVertical, RotateCcw, Trash2, XCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { isTerminalRun } from "@/components/dashboard/runStatus";
import { ApiError } from "@/lib/api";
import { useCancelRun, useDeleteRun, useRetryRun } from "@/hooks/queries";
import type { RunOut } from "@/types/api";

const MENU_WIDTH = 190;

/**
 * Lifecycle action menu (`⋯`) for a run — Cancel (in-progress runs only),
 * Retry (terminal runs only), Delete (any run; the API 409s while the run is
 * still in progress, surfaced here as "cancel the run first"). See ADR 0005 §6.
 *
 * Portalled to `document.body` with fixed positioning anchored to the trigger
 * button, per the project's floating-overlay rule — the trigger commonly sits
 * inside an animated row/header whose transform would otherwise trap the
 * menu's z-index.
 */
export function RunActionsMenu({
  run,
  onDeleted,
}: {
  run: RunOut;
  /** Called after a successful delete, e.g. to navigate away from the run. */
  onDeleted?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [confirming, setConfirming] = useState<"cancel" | "delete" | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const cancelRun = useCancelRun();
  const retryRun = useRetryRun();
  const deleteRun = useDeleteRun();

  const terminal = isTerminalRun(run.status);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = btnRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        top: r.bottom + 6,
        left: Math.max(12, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 12)),
      });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (btnRef.current?.contains(t)) return;
      if ((e.target as HTMLElement).closest?.("[data-run-actions-menu]")) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const reposition = () => place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const handleCancel = () => {
    cancelRun.mutate(run.id, {
      onSuccess: () => {
        toast.success("Run cancelled");
        setConfirming(null);
      },
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to cancel run"),
    });
  };

  const handleRetry = () => {
    setOpen(false);
    retryRun.mutate(run.id, {
      onSuccess: () => toast.success("Retrying run"),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to retry run"),
    });
  };

  const handleDelete = () => {
    deleteRun.mutate(run.id, {
      onSuccess: () => {
        toast.success("Run deleted");
        setConfirming(null);
        onDeleted?.();
      },
      onError: (e) => {
        const message =
          e instanceof ApiError && e.status === 409
            ? "Cancel the run first."
            : e instanceof Error
              ? e.message
              : "Failed to delete run";
        toast.error(message);
      },
    });
  };

  // Stop clicks anywhere in this subtree — including the portalled menu/dialog
  // below, which React still treats as a descendant for event bubbling purposes
  // even though they render into `document.body` — from reaching a clickable
  // ancestor row (e.g. RunRow's "open this run" handler). `display: contents`
  // keeps the wrapper out of layout.
  return (
    <span className="contents" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Run actions"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] text-ink-dim transition-colors hover:bg-white/[0.08] hover:text-ink"
      >
        <MoreVertical size={15} strokeWidth={2} />
      </button>

      {createPortal(
        <AnimatePresence>
          {open && pos && (
            <motion.div
              data-run-actions-menu
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="fixed z-[1000] overflow-hidden rounded-[14px] border border-white/[0.12] p-1.5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.8)]"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH, background: "rgb(24,24,32)" }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              {!terminal && (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    setConfirming("cancel");
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[12.5px] font-semibold text-[#fbbf24] hover:bg-white/[0.06]"
                >
                  <XCircle size={14} strokeWidth={2} />
                  Cancel run
                </button>
              )}
              {terminal && (
                <button
                  type="button"
                  onClick={handleRetry}
                  disabled={retryRun.isPending}
                  className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[12.5px] font-semibold text-ink-soft hover:bg-white/[0.06] disabled:opacity-50"
                >
                  <RotateCcw size={14} strokeWidth={2} />
                  Retry run
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  setConfirming("delete");
                }}
                className="flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[12.5px] font-semibold text-[#fb7185] hover:bg-white/[0.06]"
              >
                <Trash2 size={14} strokeWidth={2} />
                Delete run
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <ConfirmDialog
        open={confirming === "cancel"}
        title="Cancel this run?"
        message={`"${run.name}" will stop where it is. You can retry it afterward.`}
        confirmLabel="Cancel run"
        danger
        loading={cancelRun.isPending}
        onConfirm={handleCancel}
        onClose={() => setConfirming(null)}
      />
      <ConfirmDialog
        open={confirming === "delete"}
        title="Delete this run?"
        message={`"${run.name}" and all of its test cases, executions, and evidence will be permanently deleted.`}
        confirmLabel="Delete run"
        danger
        loading={deleteRun.isPending}
        onConfirm={handleDelete}
        onClose={() => setConfirming(null)}
      />
    </span>
  );
}
