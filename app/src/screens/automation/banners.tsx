import { AlertTriangle, Telescope } from "lucide-react";
import { Pill } from "@/components/ui/badges";
import { PRODUCT_DEFECT_HUE } from "./specStatus";
import { RegenerateWithNote } from "./RegenerateWithNote";

/** Terminal "product defect" banner — fuchsia, distinct from a script failure. */
export function ProductDefectBanner() {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl border p-4"
      style={{ borderColor: "rgba(217,70,239,.4)", background: "rgba(217,70,239,.08)" }}
    >
      <AlertTriangle size={18} strokeWidth={2.2} className="mt-0.5 shrink-0" style={{ color: PRODUCT_DEFECT_HUE }} />
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-bold" style={{ color: "#e879f9" }}>
            Product defect
          </span>
          <Pill color={PRODUCT_DEFECT_HUE} bg="rgba(217,70,239,.14)">
            Terminal
          </Pill>
        </div>
        <p className="m-0 mt-1 text-xs leading-relaxed text-muted">
          This case surfaced a product defect — it is routed to the report rather than re-run.
          Regeneration and self-heal are disabled.
        </p>
      </div>
    </div>
  );
}

/**
 * Blocked banner — dashed amber border with the block reason and an unblock path:
 * fix the underlying cause (e.g. project bootstrap), then Regenerate to retry.
 */
export function BlockedBanner({
  reason,
  onRegenerate,
  regenerating,
  onExplore,
  exploring,
}: {
  reason: string;
  onRegenerate: (comment?: string) => void;
  regenerating: boolean;
  /** Kick off a DOM-exploration session to discover the missing routes/selectors
   * (ADR 0010). When omitted, only the Regenerate path is offered. */
  onExplore?: () => void;
  exploring?: boolean;
}) {
  return (
    <div
      className="rounded-2xl border border-dashed p-4"
      style={{ borderColor: "rgba(251,191,36,.5)", background: "rgba(251,191,36,.06)" }}
    >
      <div className="mb-2 flex items-center gap-2">
        <Pill color="#fbbf24" bg="rgba(251,191,36,.14)">
          Blocked
        </Pill>
        <span className="text-[13px] font-bold">Spec is blocked</span>
      </div>
      <p className="m-0 mb-3 text-xs leading-relaxed text-ink-soft">
        {reason || "This spec is blocked and cannot run. Resolve the underlying issue first."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onExplore && (
          <button
            onClick={onExplore}
            disabled={exploring || regenerating}
            title="Drive a real browser to discover the missing routes/selectors and write them to the Knowledge Base, then regenerate"
            className="flex items-center gap-1.5 rounded-[9px] border border-sky-400/30 bg-sky-400/10 px-[13px] py-1.5 text-[12px] font-semibold text-sky-300 hover:bg-sky-400/20 disabled:opacity-60"
          >
            {exploring ? (
              <span
                className="h-[13px] w-[13px] rounded-full border-2"
                style={{ borderColor: "rgba(56,189,248,.35)", borderTopColor: "#38bdf8", animation: "spin .8s linear infinite" }}
              />
            ) : (
              <Telescope size={13} />
            )}
            {exploring ? "Exploring…" : "Explore to unblock"}
          </button>
        )}
        <RegenerateWithNote
          label="Regenerate to retry"
          variant="amber"
          regenerating={regenerating}
          onRegenerate={onRegenerate}
        />
        <span className="text-[11px] text-muted">
          Explore the live app to discover selectors, or re-run project bootstrap, then regenerate.
        </span>
      </div>
    </div>
  );
}

/**
 * Non-destructive note shown in the code panel when the last regeneration was
 * rejected by the placeholder gate — the previous good spec was kept, so the code
 * shown is unchanged.
 */
export function GateRejectedNote({ reason }: { reason: string }) {
  return (
    <div
      className="flex items-start gap-2 border-b border-white/[0.06] px-4 py-2.5"
      style={{ background: "rgba(251,191,36,.06)" }}
    >
      <AlertTriangle size={13} className="mt-[1px] shrink-0 text-warning-soft" />
      <span className="text-[11.5px] leading-relaxed text-warning-soft">
        Last regeneration rejected (kept previous good spec){reason ? ` — ${reason}` : ""}
      </span>
    </div>
  );
}
