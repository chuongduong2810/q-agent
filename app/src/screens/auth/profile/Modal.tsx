import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";

/**
 * Centered glass modal for the Profile screen (change password, 2FA, delete
 * account). Portalled to `document.body` with fixed positioning per the
 * project's floating-overlay rule; `AnimatePresence` directly wraps the
 * animating `motion` child. Opaque panel background (no backdrop-filter).
 */
export function Modal({
  open,
  title,
  subtitle,
  onClose,
  children,
  locked = false,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** When true, backdrop click + Escape won't close (e.g. mid-request). */
  locked?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !locked) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);

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
            if (e.target === e.currentTarget && !locked) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.16 }}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="w-full max-w-[420px] rounded-2xl border border-white/[0.12] p-6 shadow-[0_30px_70px_-20px_rgba(0,0,0,.8)]"
            style={{ background: "rgb(24,24,32)" }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <div className="text-[16px] font-bold text-ink">{title}</div>
                {subtitle ? (
                  <div className="mt-1 text-[12.5px] leading-[1.5] text-muted">{subtitle}</div>
                ) : null}
              </div>
              <button
                type="button"
                onClick={onClose}
                disabled={locked}
                aria-label="Close"
                className="flex shrink-0 text-faint transition-colors hover:text-ink disabled:opacity-40"
              >
                <X size={18} />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Small spinner matching the design's inline loading affordance. */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={
        "inline-block h-[15px] w-[15px] shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white " +
        (className ?? "")
      }
    />
  );
}
