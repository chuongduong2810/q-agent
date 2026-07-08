import { AnimatePresence, motion } from "framer-motion";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/**
 * Centered confirm dialog for destructive/irreversible actions (cancel run,
 * delete run). Portalled to `document.body` with fixed positioning per the
 * project's floating-overlay rule — triggers can sit inside animated rows
 * whose transform creates a stacking context that would trap a non-portalled
 * dialog's z-index.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Never mind",
  danger = false,
  loading = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[1100] flex items-center justify-center bg-black/60 p-5"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && !loading) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            className="w-full max-w-[380px] rounded-2xl border border-white/[0.12] p-5 shadow-[0_30px_70px_-20px_rgba(0,0,0,.8)]"
            style={{ background: "rgb(24,24,32)" }}
          >
            <div className="mb-1.5 text-[15px] font-bold text-ink">{title}</div>
            <div className="mb-5 text-[13px] leading-[1.5] text-ink-dim">{message}</div>
            <div className="flex justify-end gap-2.5">
              <Button variant="glass" size="sm" onClick={onClose} disabled={loading}>
                {cancelLabel}
              </Button>
              <Button
                variant={danger ? "danger" : "primary"}
                size="sm"
                onClick={onConfirm}
                disabled={loading}
              >
                {loading ? "Working…" : confirmLabel}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
