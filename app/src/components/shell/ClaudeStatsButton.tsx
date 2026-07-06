import { ChevronDown, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Pill } from "@/components/ui/badges";
import { useAiStats } from "@/hooks/queries";
import type { ClaudeStats } from "@/types/api";

const PANEL_WIDTH = 300;

/** Compact tokens → "1.5K" / "2.4M" (integers below 1000 stay as-is). */
function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** USD → "$42.60". */
function fmtCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Latency ms → "1.4s". */
function fmtLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** ISO → short "Jul 6"; empty for null. */
function fmtResetDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Strip the leading "Claude " so the chip/breakdown show the short name. */
function shortModel(label: string): string {
  return label.replace(/^Claude\s+/i, "").trim() || label;
}

/**
 * Top-bar Claude usage chip (`● ⭐ Sonnet 5 ▾`) + a portalled dropdown panel of
 * usage stats read from `GET /ai/stats`. Present in both the global TopBar and the
 * run-context header. Follows the project's floating-overlay rule: the panel is
 * portalled to `document.body`, fixed-positioned anchored below-right of the chip
 * with an opaque background, and closes on outside-click or Escape.
 */
export function ClaudeStatsButton() {
  const { data: stats } = useAiStats();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);

  const label = stats ? shortModel(stats.modelLabel) : "Claude";
  const operational = stats?.operational ?? false;

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-[9px] border border-white/[0.1] bg-white/[0.05] px-[11px] py-1.5 text-[11px] font-semibold text-ink-soft hover:bg-white/[0.09]"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: operational ? "#34d399" : "#f43f5e" }}
        />
        <Star size={12} strokeWidth={2} style={{ color: "#fbbf24" }} fill="#fbbf24" />
        {label}
        <ChevronDown size={12} strokeWidth={2} />
      </button>

      {stats && (
        <StatsPanel open={open} onClose={() => setOpen(false)} anchorRef={btnRef} stats={stats} />
      )}
    </>
  );
}

function StatsPanel({
  open,
  onClose,
  anchorRef,
  stats,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: React.RefObject<HTMLButtonElement | null>;
  stats: ClaudeStats;
}) {
  const navigate = useNavigate();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({
        top: r.bottom + 6,
        left: Math.max(12, Math.min(r.right - PANEL_WIDTH, window.innerWidth - PANEL_WIDTH - 12)),
      });
    };
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (anchorRef.current?.contains(t)) return;
      if ((e.target as HTMLElement).closest?.("[data-claude-stats]")) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
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
  }, [open, anchorRef, onClose]);

  if (!open || !pos) return null;

  const budgeted = stats.weekBudget > 0;
  const pct = budgeted ? Math.min(1, stats.weekTokens / stats.weekBudget) : 0;
  const resetDate = fmtResetDate(stats.weekResetsAt);
  const short = shortModel(stats.modelLabel);

  const usageLabel = budgeted ? `${Math.round(pct * 100)}% used` : `${fmtTokens(stats.weekTokens)} used`;
  const usageSub = budgeted
    ? `${fmtTokens(stats.weekTokens)} / ${fmtTokens(stats.weekBudget)} tokens${resetDate ? ` · resets ${resetDate}` : ""}`
    : `${fmtTokens(stats.weekTokens)} tokens${resetDate ? ` · resets ${resetDate}` : ""}`;

  const breakdown: Array<[string, number, string]> = [
    ["Input", stats.breakdown.input, "#a78bfa"],
    ["Output", stats.breakdown.output, "#22d3ee"],
    ["Cache read", stats.breakdown.cacheRead, "#34d399"],
    ["Cache write", stats.breakdown.cacheWrite, "#fbbf24"],
  ];

  return createPortal(
    <div
      data-claude-stats
      className="fixed z-[1000] rounded-[14px] border border-white/[0.12] p-[14px] shadow-[0_30px_70px_-20px_#000]"
      style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH, background: "rgba(24,24,32,.97)" }}
    >
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]"
          style={{ background: "linear-gradient(135deg,#8b5cf6,#f59e0b)" }}
        >
          <Star size={16} strokeWidth={2} color="#fff" fill="#fff" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-ink">{stats.modelLabel}</div>
          <div
            className="flex items-center gap-1.5 text-[11px] font-semibold"
            style={{ color: stats.operational ? "#34d399" : "#f43f5e" }}
          >
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: stats.operational ? "#34d399" : "#f43f5e" }} />
            {stats.operational ? "Operational" : "Unavailable"}
          </div>
        </div>
        <Pill color="#c4b5fd" bg="rgba(139,92,246,.16)">
          {stats.ctxWindow} ctx
        </Pill>
      </div>

      {/* Tokens this week */}
      <div className="mt-[15px]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-ink-soft">Tokens this week</span>
          <span className="text-[11px] font-semibold text-ink-dim">{usageLabel}</span>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
          {budgeted ? (
            <div
              className="h-full rounded-full"
              style={{ width: `${pct * 100}%`, background: "linear-gradient(90deg,#8b5cf6,#22d3ee)" }}
            />
          ) : (
            <div className="h-full w-full rounded-full bg-white/[0.06]" />
          )}
        </div>
        <div className="mt-1.5 text-[10.5px] text-ink-dim">{usageSub}</div>
      </div>

      {/* Stat tiles */}
      <div className="mt-[15px] grid grid-cols-3 gap-2">
        {(
          [
            [String(stats.requestsToday), "Requests today"],
            [fmtLatency(stats.avgLatencyMs), "Avg latency"],
            [fmtCost(stats.costMonth), "Cost · month"],
          ] as Array<[string, string]>
        ).map(([value, tileLabel]) => (
          <div key={tileLabel} className="rounded-[10px] border border-white/[0.07] bg-white/[0.04] px-2 py-2.5">
            <div className="text-[14px] font-bold text-ink">{value}</div>
            <div className="mt-0.5 text-[9.5px] leading-tight text-ink-dim">{tileLabel}</div>
          </div>
        ))}
      </div>

      {/* Token breakdown */}
      <div className="mt-[15px] mb-[7px] text-[9px] font-bold tracking-[0.1em] text-ink-dim">
        TOKEN BREAKDOWN · {short.toUpperCase()}
      </div>
      <div className="flex flex-col gap-1.5">
        {breakdown.map(([name, value, color]) => (
          <div key={name} className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
            <span className="flex-1 text-[11px] text-ink-soft">{name}</span>
            <span className="font-mono text-[11px] font-semibold text-ink">{fmtTokens(value)}</span>
          </div>
        ))}
      </div>

      {/* Manage AI settings */}
      <button
        onClick={() => {
          navigate("/settings");
          onClose();
        }}
        className="mt-[15px] flex w-full items-center justify-center gap-2 rounded-[10px] border border-white/[0.1] bg-white/[0.05] py-2.5 text-[12px] font-semibold text-ink-soft hover:bg-white/[0.09]"
      >
        <SlidersHorizontal size={13} strokeWidth={2} />
        Manage AI settings
      </button>
    </div>,
    document.body,
  );
}
