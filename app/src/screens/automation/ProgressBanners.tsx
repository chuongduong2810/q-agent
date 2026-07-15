import { Check, Sparkles, Telescope } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { THINKING_STEPS } from "./useThinkingSteps";
import { describeExploreStep } from "./exploreStep";
import type { ExploreProgress, ExploreStep, GenProgress, HealProgress } from "./useAutomationEvents";

/** Full-height placeholder card shown while the first generation pass runs. */
export function ThinkingBanner({ runCode, thinkStep }: { runCode: string | undefined; thinkStep: number }) {
  return (
    <GlassCard className="p-4 md:p-[26px]" style={{ borderColor: "rgba(139,92,246,.28)" }}>
      <div className="mb-[22px] flex items-center gap-[13px]">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-[14px]"
          style={{ background: "linear-gradient(135deg,#8b5cf6,#6366f1)", boxShadow: "0 0 26px rgba(139,92,246,.6)" }}
        >
          <Sparkles size={22} color="#fff" />
        </div>
        <div>
          <div className="text-[15px] font-bold">Writing Playwright automation</div>
          <div className="mt-0.5 text-xs text-muted">for every approved case in {runCode}</div>
        </div>
      </div>
      <div className="flex flex-col gap-[13px]">
        {THINKING_STEPS.map((text, i) => {
          const done = i < thinkStep;
          const active = i === thinkStep;
          if (!done && !active) return null;
          return (
            <div key={text} className="flex items-center gap-3 text-[13.5px]">
              {done ? (
                <span className="flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full bg-success">
                  <Check size={12} color="#fff" strokeWidth={3} />
                </span>
              ) : (
                <span
                  className="h-[19px] w-[19px] shrink-0 rounded-full border-2"
                  style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
                />
              )}
              <span className={done ? "text-muted" : "font-semibold text-ink"}>{text}</span>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

/** Compact "Generating automation…" banner with live progress detail. */
export function GeneratingBanner({ genProgress }: { genProgress: GenProgress | null }) {
  return (
    <GlassCard className="mb-3.5 flex items-center gap-3 p-4" style={{ borderColor: "rgba(139,92,246,.28)" }}>
      <span
        className="h-[18px] w-[18px] shrink-0 rounded-full border-2"
        style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
      />
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold">
          Generating automation…
          {genProgress && genProgress.total > 0 ? ` ${genProgress.done}/${genProgress.total}` : ""}
        </div>
        {genProgress && (genProgress.file || genProgress.message) && (
          <div className="mt-0.5 truncate text-xs text-muted">
            {genProgress.file ? <span className="font-mono">{genProgress.file}</span> : null}
            {genProgress.file && genProgress.message ? " · " : ""}
            {genProgress.message}
          </div>
        )}
      </div>
    </GlassCard>
  );
}

/** Compact self-heal progress banner shown while a heal is in flight. */
export function HealProgressBanner({ healProgress }: { healProgress: HealProgress }) {
  return (
    <GlassCard className="mb-3.5 flex items-center gap-3 p-4" style={{ borderColor: "rgba(16,185,129,.32)" }}>
      <span
        className="h-[18px] w-[18px] shrink-0 rounded-full border-2"
        style={{ borderColor: "rgba(52,211,153,.35)", borderTopColor: "#34d399", animation: "spin .8s linear infinite" }}
      />
      <div className="min-w-0">
        <div className="text-[13.5px] font-bold">
          Self-healing {healProgress.caseCode} — attempt {healProgress.attempt}/{healProgress.maxAttempts}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted">
          {healProgress.phase === "fixing"
            ? `Fixing with Claude — ${healProgress.error || "addressing the failure"}`
            : "Running the spec…"}
        </div>
      </div>
    </GlassCard>
  );
}

/** Live DOM-exploration banner: a stepped list of what the agent has observed
 * and done so far, driving toward unblocking the case (mirrors ThinkingBanner). */
export function ExploreProgressBanner({ exploreProgress }: { exploreProgress: ExploreProgress }) {
  const { steps } = exploreProgress;
  const latest = steps[steps.length - 1] as ExploreStep | undefined;
  return (
    <GlassCard className="mb-3.5 p-4 md:p-[22px]" style={{ borderColor: "rgba(56,189,248,.32)" }}>
      <div className="mb-[18px] flex items-center gap-[13px]">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-[14px]"
          style={{ background: "linear-gradient(135deg,#38bdf8,#0ea5e9)", boxShadow: "0 0 26px rgba(56,189,248,.55)" }}
        >
          <Telescope size={22} color="#fff" />
        </div>
        <div className="min-w-0">
          <div className="text-[15px] font-bold">Exploring the live app to unblock</div>
          <div className="mt-0.5 text-xs text-muted">
            Driving a real browser to discover routes &amp; selectors
            {latest ? ` · $${latest.remainingBudgetUsd.toFixed(2)} budget left` : ""}
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-[11px]">
        {steps.map((s) => {
          const done = s.action === "done";
          const failed = s.ok === false;
          return (
            <div key={s.step} className="flex items-start gap-3 text-[13.5px]">
              <span
                className={`mt-[1px] flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full ${
                  failed ? "bg-rose-500/80" : "bg-sky-500"
                }`}
              >
                <Check size={12} color="#fff" strokeWidth={3} />
              </span>
              <div className="min-w-0">
                <span className="font-semibold text-ink">{describeExploreStep(s)}</span>
                {s.reasoning && <span className="ml-1.5 text-xs text-muted">— {s.reasoning}</span>}
                {s.observedUrl && !done && (
                  <span className="ml-1.5 font-mono text-[11px] text-faint">@ {s.observedUrl}</span>
                )}
              </div>
            </div>
          );
        })}
        {!exploreProgress.done && (
          <div className="flex items-center gap-3 text-[13.5px]">
            <span
              className="h-[19px] w-[19px] shrink-0 rounded-full border-2"
              style={{ borderColor: "rgba(56,189,248,.35)", borderTopColor: "#38bdf8", animation: "spin .8s linear infinite" }}
            />
            <span className="font-semibold text-ink">Deciding the next step…</span>
          </div>
        )}
      </div>
    </GlassCard>
  );
}
