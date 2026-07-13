import { AnimatePresence, motion } from "framer-motion";
import { Check, Sparkles, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Spinner } from "@/components/ui/misc";
import { useAiActivity } from "@/hooks/useAiActivity";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { AiCall } from "@/types/api";

function elapsed(startedAt: string, now: number): string {
  const s = Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000));
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;
}

/**
 * Top-bar indicator that shows when the Claude CLI is actively running (with a
 * live elapsed timer), so long AI calls read as "working", not "hung". Clicking
 * opens a dropdown of running + recent calls with durations.
 */
export function AiActivityIndicator() {
  const { data } = useAiActivity();
  const running = data?.running ?? [];
  const recent = data?.recent ?? [];
  const isRunning = running.length > 0;

  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Tick every second while something is running so the elapsed timer advances.
  useEffect(() => {
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);

  // Anchor the (portalled) panel to the trigger, right-aligned, in viewport coords.
  const place = () => {
    // Mobile renders a full-width bottom sheet, so no anchoring is needed.
    if (isMobile) return;
    const el = triggerRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 8, right: window.innerWidth - r.right });
    }
  };

  // Close on outside click; reposition on scroll/resize.
  useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const reposition = () => place();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("resize", reposition);
    };
  }, [open]);

  const primary = running[0];

  // Shared panel content (header + call list), rendered inside the anchored
  // desktop dropdown or the mobile bottom sheet.
  const panelBody = (
    <>
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-4 py-3">
        <Sparkles size={15} className="text-violet" />
        <span className="text-[13px] font-bold">Claude CLI activity</span>
        <span className="ml-auto text-[11px] text-ink-dim">
          {isRunning ? `${running.length} running` : "idle"}
        </span>
      </div>
      <div className="max-h-[360px] flex-1 overflow-y-auto p-2">
        {running.length === 0 && recent.length === 0 && (
          <div className="px-3 py-6 text-center text-[12.5px] text-ink-dim">
            No Claude CLI calls yet.
          </div>
        )}
        {running.map((c) => (
          <Row key={`r-${c.id}`} call={c} now={now} />
        ))}
        {recent.map((c) => (
          <Row key={`h-${c.id}`} call={c} now={now} />
        ))}
      </div>
    </>
  );

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        onClick={() => setOpen((o) => !o)}
        title="Claude CLI activity"
        className="flex h-[38px] items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 text-[12.5px] font-semibold text-ink-soft hover:bg-white/[0.09]"
        style={isRunning ? { borderColor: "rgba(139,92,246,.4)", background: "rgba(139,92,246,.14)" } : undefined}
      >
        {isRunning ? (
          <>
            <Spinner size={13} />
            <span className="max-w-[180px] truncate text-violet">{primary.label}</span>
            <span className="font-mono text-[11px] text-ink-dim">{elapsed(primary.startedAt, now)}</span>
          </>
        ) : (
          <>
            <Sparkles size={14} className="text-violet" />
            <span>AI</span>
          </>
        )}
      </button>

      {createPortal(
        <AnimatePresence>
          {open &&
            (isMobile ? (
              <motion.div
                key="ai-scrim"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="fixed inset-0 z-[1000]"
                style={{ background: "rgba(4,4,8,.6)", backdropFilter: "blur(2px)" }}
              >
                <motion.div
                  ref={panelRef}
                  key="ai-sheet"
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                  className="absolute inset-x-0 bottom-0 flex max-h-[88vh] flex-col overflow-hidden rounded-t-[26px] border-t border-white/[0.12]"
                  style={{ background: "rgb(24,24,32)" }}
                >
                  <div className="flex justify-center pt-2.5">
                    <span className="h-1 w-10 rounded-full bg-white/25" />
                  </div>
                  {panelBody}
                </motion.div>
              </motion.div>
            ) : (
              pos && (
                <motion.div
                  ref={panelRef}
                  key="ai-panel"
                  initial={{ opacity: 0, y: -6, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -6, scale: 0.98 }}
                  transition={{ duration: 0.16 }}
                  className="fixed z-[1000] w-[340px] overflow-hidden rounded-2xl border border-white/[0.12] shadow-[0_30px_70px_-20px_rgba(0,0,0,.8)]"
                  style={{ top: pos.top, right: pos.right, background: "rgb(24,24,32)" }}
                >
                  {panelBody}
                </motion.div>
              )
            ))}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}

function Row({ call, now }: { call: AiCall; now: number }) {
  const running = call.status === "running";
  return (
    <div className="flex items-center gap-3 rounded-xl px-3 py-2 hover:bg-white/[0.04]">
      <span className="flex h-[18px] w-[18px] shrink-0 items-center justify-center">
        {running ? (
          <Spinner size={14} />
        ) : call.status === "ok" ? (
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-success">
            <Check size={11} color="#fff" strokeWidth={3} />
          </span>
        ) : (
          <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-danger">
            <X size={11} color="#fff" strokeWidth={3} />
          </span>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12.5px] font-semibold">{call.label}</div>
        {call.skill && <div className="truncate text-[11px] text-ink-dim">{call.skill}</div>}
      </div>
      <span className="shrink-0 font-mono text-[11px] text-ink-dim">
        {running
          ? elapsed(call.startedAt, now)
          : call.durationMs != null
            ? `${(call.durationMs / 1000).toFixed(1)}s`
            : ""}
      </span>
    </div>
  );
}
