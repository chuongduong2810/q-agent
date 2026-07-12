import { ChevronDown, Wand2 } from "lucide-react";
import { useState } from "react";
import type { HealAttempt, HealReport } from "@/types/api";

/** Relative "time ago" from an ISO timestamp, for the heal report header. */
export function healTimeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Renders a unified-diff string with +/-/@@ lines colored. */
export function DiffBlock({ diff }: { diff: string }) {
  return (
    <div className="mt-2 overflow-x-auto rounded-lg border border-white/[0.07] bg-[rgba(8,8,13,.6)] p-2.5">
      <pre className="m-0 font-mono text-[11.5px] leading-[1.6]">
        {diff.split("\n").map((line, i) => {
          const c = line.startsWith("+")
            ? "#6ee7b7"
            : line.startsWith("-")
              ? "#fb7185"
              : line.startsWith("@@")
                ? "#67e8f9"
                : "#8b8b9e";
          return (
            <div key={i} style={{ color: c, whiteSpace: "pre" }}>
              {line || " "}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

/** Collapsible "Self-heal timeline" — the per-attempt failure, what Claude
 * changed (diff), and the final outcome of the last heal for a spec. */
export function HealTimeline({ report }: { report: HealReport }) {
  const [open, setOpen] = useState(true);
  const healed = report.finalStatus === "pass";
  const n = report.attempts.length;
  return (
    <div className="overflow-hidden rounded-2xl border border-white/[0.09]" style={{ background: "rgba(8,8,13,.55)" }}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2.5 border-b border-white/[0.06] px-4 py-3 text-left hover:bg-white/[0.03]"
      >
        <Wand2 size={14} className="shrink-0 text-emerald-300" />
        <span className="text-[13px] font-bold">Self-heal timeline</span>
        <span
          className="rounded-full px-2 py-0.5 text-[11px] font-bold"
          style={
            healed
              ? { background: "rgba(16,185,129,.14)", color: "#6ee7b7" }
              : { background: "rgba(244,63,94,.14)", color: "#fb7185" }
          }
        >
          {healed ? `Healed after ${n} attempt${n === 1 ? "" : "s"}` : `Still failing after ${n} attempt${n === 1 ? "" : "s"}`}
        </span>
        <span className="ml-auto text-[11px] text-faint">{healTimeAgo(report.healedAt)}</span>
        <ChevronDown
          size={15}
          className="shrink-0 text-muted transition-transform"
          style={{ transform: open ? "rotate(180deg)" : "none" }}
        />
      </button>
      {open && (
        <div className="flex flex-col gap-2.5 p-3.5">
          {report.attempts.map((a: HealAttempt) => (
            <div key={a.attempt} className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3">
              <div className="flex items-center gap-2">
                <span className="text-[12.5px] font-bold">Attempt {a.attempt}</span>
                <span
                  className="rounded-md px-1.5 py-0.5 text-[10px] font-bold"
                  style={
                    a.status === "pass"
                      ? { background: "rgba(16,185,129,.14)", color: "#6ee7b7" }
                      : { background: "rgba(244,63,94,.14)", color: "#fb7185" }
                  }
                >
                  {a.status === "pass" ? "PASSED" : "FAILED"}
                </span>
                <span className="ml-auto font-mono text-[11px] text-faint">
                  {(a.durationMs / 1000).toFixed(1)}s
                </span>
              </div>
              {a.error && (
                <div className="mt-2 max-h-40 overflow-auto rounded-lg border border-white/[0.06] bg-[rgba(8,8,13,.6)] p-2.5">
                  <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[11.5px] leading-[1.55] text-[#f2b8c0]">
                    {a.error}
                  </pre>
                </div>
              )}
              {a.fixed && (
                <>
                  <div className="mt-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-300">
                    <Wand2 size={12} /> Claude rewrote the spec
                  </div>
                  {a.diff && <DiffBlock diff={a.diff} />}
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
