import { Download, Pencil, Play, Save, Sparkles, Wand2, X } from "lucide-react";
import type { AutomationSpecOut } from "@/types/api";
import { Pill } from "@/components/ui/badges";
import { GateRejectedNote } from "./banners";
import { CodeHighlight, type FoldRange } from "./CodeViewer";
import { RegenerateWithNote } from "./RegenerateWithNote";

/**
 * The right-hand code panel for the selected spec: header toolbar (Save/Cancel
 * while editing, or Collapse/Expand/Edit/Regenerate/Run/Self-heal/Copy/Download),
 * the placeholder-gate note, the editing textarea vs the read-only highlighted
 * view, and the footer "Run tests" bar. Pure presentation — every action is a
 * callback prop owned by the parent screen.
 */
export function SpecCodePanel({
  selectedSpec,
  editing,
  draft,
  setDraft,
  foldRanges,
  folded,
  toggleFold,
  collapseAll,
  expandAll,
  generating,
  specRegenerating,
  healingThisCase,
  runningThisSpec,
  runSuppressed,
  isBlocked,
  isProductDefect,
  gateRejected,
  gateReport,
  updateSpecPending,
  startExecutionPending,
  copyLabel,
  changedLines,
  regenVersion,
  feedbackSignal,
  onCopy,
  onDownload,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onRegenerate,
  onRunSpec,
  onStartHeal,
  onStartExecution,
  onOpenChat,
  codeOverride,
}: {
  selectedSpec: AutomationSpecOut | null;
  editing: boolean;
  draft: string;
  setDraft: (value: string) => void;
  foldRanges: FoldRange[];
  folded: Set<number>;
  toggleFold: (start: number) => void;
  collapseAll: () => void;
  expandAll: () => void;
  generating: boolean;
  specRegenerating: boolean;
  healingThisCase: boolean;
  runningThisSpec: boolean;
  runSuppressed: boolean;
  isBlocked: boolean;
  isProductDefect: boolean;
  gateRejected: boolean;
  gateReport: { outcome?: string; reason?: string } | null;
  updateSpecPending: boolean;
  startExecutionPending: boolean;
  copyLabel: string;
  changedLines?: Set<number>;
  regenVersion?: number;
  feedbackSignal?: number;
  onCopy: () => void;
  onDownload: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onRegenerate: (comment?: string) => void;
  onRunSpec: () => void;
  onStartHeal: () => void;
  onStartExecution: () => void;
  onOpenChat: () => void;
  /** When set, shown in the code viewer instead of the spec's code — used to
   * "type out" a chat edit's new code before the query-backed code settles. */
  codeOverride?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-2xl border ${
        isBlocked ? "border-dashed border-white/20" : "border-white/[0.09]"
      }`}
      style={{ background: "rgba(8,8,13,.8)", backdropFilter: "blur(22px)" }}
    >
      <div className="flex flex-wrap items-center gap-2.5 border-b border-white/[0.06] px-4 py-3">
        <span className="font-mono text-[12.5px] text-ink-soft">tests/{selectedSpec?.filename}</span>
        <span className="rounded-md px-2 py-0.5 text-[10px] font-bold" style={{ background: "rgba(34,211,238,.13)", color: "#67e8f9" }}>
          TypeScript
        </span>
        <div className="flex w-full flex-wrap gap-1.5 md:ml-auto md:w-auto">
          {editing ? (
            <>
              <button
                onClick={onSaveEdit}
                disabled={updateSpecPending}
                className="flex items-center gap-1.5 rounded-[9px] border border-violet/40 bg-violet/20 px-[11px] py-1.5 text-[11.5px] font-semibold text-violet hover:bg-violet/30 disabled:opacity-60"
              >
                <Save size={13} />
                {updateSpecPending ? "Saving…" : "Save"}
              </button>
              <button
                onClick={onCancelEdit}
                disabled={updateSpecPending}
                className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
              >
                <X size={13} />
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                onClick={collapseAll}
                disabled={foldRanges.length === 0}
                className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-40"
              >
                Collapse all
              </button>
              <button
                onClick={expandAll}
                disabled={folded.size === 0}
                className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-40"
              >
                Expand all
              </button>
              <button
                onClick={onStartEdit}
                disabled={generating || specRegenerating}
                className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-40"
              >
                <Pencil size={13} />
                Edit
              </button>
              <RegenerateWithNote
                label="Regenerate"
                regenerating={specRegenerating}
                disabled={isProductDefect}
                onRegenerate={onRegenerate}
                openSignal={feedbackSignal}
              />
              {regenVersion != null && (
                <Pill color="#a78bfa" bg="rgba(167,139,250,.14)">
                  v{regenVersion}
                </Pill>
              )}
              <button
                onClick={onRunSpec}
                disabled={generating || specRegenerating || healingThisCase || runningThisSpec || runSuppressed}
                title={
                  isBlocked
                    ? "Run anyway — this spec is blocked and will likely fail until unblocked"
                    : isProductDefect
                      ? "Product defect — routed to report, not re-run"
                      : "Run only this spec"
                }
                className="flex items-center gap-1.5 rounded-[9px] border border-cyan-400/25 bg-cyan-400/10 px-[11px] py-1.5 text-[11.5px] font-semibold text-cyan-300 hover:bg-cyan-400/20 disabled:opacity-60"
              >
                {runningThisSpec ? (
                  <span
                    className="h-[13px] w-[13px] rounded-full border-2"
                    style={{ borderColor: "rgba(34,211,238,.35)", borderTopColor: "#22d3ee", animation: "spin .8s linear infinite" }}
                  />
                ) : (
                  <Play size={13} fill="currentColor" />
                )}
                {runningThisSpec ? "Running…" : "Run"}
              </button>
              <button
                onClick={onStartHeal}
                disabled={generating || specRegenerating || healingThisCase || runSuppressed}
                title={
                  isBlocked
                    ? "Self-heal — run it and let Claude try to fix/unblock it (fixes are still gated, so a missing-Knowledge-Base block needs a KB refresh)"
                    : isProductDefect
                      ? "Product defect is terminal — self-heal disabled"
                      : "Run this spec; if it fails, let Claude fix it from the error and retry"
                }
                className="flex items-center gap-1.5 rounded-[9px] border border-emerald-400/25 bg-emerald-400/10 px-[11px] py-1.5 text-[11.5px] font-semibold text-emerald-300 hover:bg-emerald-400/20 disabled:opacity-60"
              >
                {healingThisCase ? (
                  <span
                    className="h-[13px] w-[13px] rounded-full border-2"
                    style={{ borderColor: "rgba(52,211,153,.35)", borderTopColor: "#34d399", animation: "spin .8s linear infinite" }}
                  />
                ) : (
                  <Wand2 size={13} />
                )}
                {healingThisCase ? "Healing…" : "Self-heal"}
              </button>
              <button
                onClick={onOpenChat}
                disabled={generating || specRegenerating}
                title="Edit this spec with Q-Agent (AI chat)"
                className="flex items-center gap-1.5 rounded-[9px] border border-violet-400/25 bg-violet-400/10 px-[11px] py-1.5 text-[11.5px] font-semibold text-violet-300 hover:bg-violet-400/20 disabled:opacity-60"
              >
                <Sparkles size={13} /> Edit with Q-Agent
              </button>
              <button
                onClick={onCopy}
                disabled={specRegenerating}
                className="rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
              >
                {copyLabel}
              </button>
              <button
                onClick={onDownload}
                disabled={specRegenerating}
                className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/5 px-[11px] py-1.5 text-[11.5px] font-semibold text-ink-soft hover:bg-white/10 disabled:opacity-60"
              >
                <Download size={13} />
                Download
              </button>
            </>
          )}
        </div>
      </div>
      {gateRejected && <GateRejectedNote reason={gateReport?.reason ?? ""} />}
      {editing ? (
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
          wrap="off"
          className="block w-full resize-y overflow-auto whitespace-pre px-4 py-[18px] font-mono text-[12.5px] leading-[1.75] text-ink outline-none"
          style={{ minHeight: 380, background: "rgba(8,8,13,.6)", tabSize: 2 }}
        />
      ) : selectedSpec ? (
        <div className="relative">
          <div
            style={{
              opacity: generating || specRegenerating ? 0.4 : 1,
              transition: "opacity .2s ease",
            }}
          >
            <CodeHighlight
              code={codeOverride ?? selectedSpec.code}
              foldRanges={foldRanges}
              folded={folded}
              onToggle={toggleFold}
              changedLines={changedLines}
            />
          </div>
          {(generating || specRegenerating) && (
            <div className="pointer-events-none absolute inset-0 flex items-start justify-center pt-8">
              <div className="flex items-center gap-2 rounded-full border border-white/10 bg-black/70 px-3.5 py-1.5 text-[11.5px] font-semibold text-ink-soft backdrop-blur">
                <span
                  className="h-[13px] w-[13px] rounded-full border-2"
                  style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
                />
                {specRegenerating ? "Regenerating…" : "Updating…"}
              </div>
            </div>
          )}
        </div>
      ) : null}
      <div className="flex flex-col gap-2.5 border-t border-white/[0.06] px-4 py-3.5 md:flex-row md:items-center">
        <span className="text-xs text-muted md:flex-1">Execute the approved suite in parallel across the Run</span>
        <button
          onClick={onStartExecution}
          disabled={startExecutionPending}
          className="flex w-full items-center justify-center gap-2 rounded-xl px-[18px] py-2.5 text-[13px] font-bold text-white disabled:opacity-60 md:w-auto"
          style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", boxShadow: "0 8px 22px -8px rgba(139,92,246,.8)" }}
        >
          <Play size={14} fill="#fff" />
          Run tests
        </button>
      </div>
    </div>
  );
}
