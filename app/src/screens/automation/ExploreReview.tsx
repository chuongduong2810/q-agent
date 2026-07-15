import { ChevronDown, Telescope } from "lucide-react";
import { useState } from "react";
import type { ExploreStatus } from "@/types/api";
import { RegenerateWithNote } from "./RegenerateWithNote";
import { describeExploreStep, EXPLORE_HUE } from "./exploreStep";
import type { ExploreProgress } from "./useAutomationEvents";

/** Friendly label for a session's stop reason (ADR 0010 §4). */
function stopReasonLabel(reason: string | null | undefined): string {
  switch (reason) {
    case "done":
      return "Goal reached";
    case "step_cap":
      return "Hit the step cap";
    case "budget":
      return "Hit the cost budget";
    case "repeat":
      return "Stopped — no further progress";
    case "unreachable":
      return "Target screen unreachable";
    default:
      return reason || "Finished";
  }
}

/**
 * Collapsible "Exploration results" panel shown after a DOM-exploration session
 * ends (mirrors HealTimeline). The step trail comes from the WS stream
 * (`progress`); the durable discovered counts + stop reason come from the
 * repo-scoped `explore/status` poll (`status`). When the KB was enriched, a
 * Regenerate CTA lets the reviewer retry the now-grounded case.
 */
export function ExploreReview({
  progress,
  status,
  regenerating,
  onRegenerate,
}: {
  progress: ExploreProgress;
  status: ExploreStatus | undefined;
  regenerating: boolean;
  onRegenerate: (comment?: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const routes = status?.discoveredRoutes ?? 0;
  const selectors = status?.discoveredSelectors ?? 0;
  const wroteKb = status?.wroteKb ?? false;
  const steps = progress.steps;

  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09]" style={{ background: "rgba(8,8,13,.55)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-4 py-3 text-left hover:bg-white/[0.03]"
      >
        <Telescope size={14} className="shrink-0" style={{ color: EXPLORE_HUE }} />
        <span className="text-[13px] font-bold">Exploration results</span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={
            wroteKb
              ? { background: "rgba(56,189,248,.14)", color: EXPLORE_HUE }
              : { background: "rgba(148,163,184,.14)", color: "#94a3b8" }
          }
        >
          {wroteKb ? `KB enriched · ${routes} route${routes === 1 ? "" : "s"}, ${selectors} selector${selectors === 1 ? "" : "s"}` : "Nothing discovered"}
        </span>
        <span className="ml-auto text-[11px] text-faint">{stopReasonLabel(status?.stopReason)}</span>
        <ChevronDown
          size={15}
          className="shrink-0 text-muted transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-3 p-3.5">
          {steps.length > 0 && (
            <div className="flex flex-col gap-2">
              {steps.map((s) => (
                <div key={s.step} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-2.5">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[11px] text-faint">{s.step}</span>
                    <span className="text-[12.5px] font-semibold text-ink">{describeExploreStep(s)}</span>
                    {s.ok === false && (
                      <span className="rounded-md bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                        no-op
                      </span>
                    )}
                    {s.observedUrl && (
                      <span className="ml-auto truncate font-mono text-[11px] text-faint">{s.observedUrl}</span>
                    )}
                  </div>
                  {s.reasoning && <p className="m-0 mt-1 text-[11.5px] leading-relaxed text-muted">{s.reasoning}</p>}
                </div>
              ))}
            </div>
          )}
          {wroteKb ? (
            <div className="flex flex-wrap items-center gap-3">
              <RegenerateWithNote
                label="Regenerate with the new KB"
                regenerating={regenerating}
                onRegenerate={onRegenerate}
              />
              <span className="text-[11px] text-muted">
                Runtime-verified routes/selectors were written to the Knowledge Base — regenerate to unblock.
              </span>
            </div>
          ) : (
            <p className="m-0 text-[11.5px] leading-relaxed text-muted">
              No usable page state was observed, so nothing was written to the Knowledge Base — the case stays
              blocked. Check the app is reachable in this environment, then try again.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
