import { ChevronDown, Info, RefreshCw, SlidersHorizontal, Star } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Pill } from "@/components/ui/badges";
import { useAiStats, useRefreshAiStats } from "@/hooks/queries";
import type { ByModelUsage, ClaudeStats, UsageWindow } from "@/types/api";

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

/** ISO (UTC) → local time-of-day "3:45 PM"; empty for missing/invalid. */
function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** ISO (UTC) → local "Jul 6, 3:45 PM"; empty for missing/invalid. */
function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Strip the leading "Claude " so the chip/breakdown show the short name. */
function shortModel(label: string): string {
  return label.replace(/^Claude\s+/i, "").trim() || label;
}

/** Safe fallback so the panel renders while the endpoint is on the old shape. */
const EMPTY_WINDOW: UsageWindow = {
  costUsd: 0,
  tokens: 0,
  requests: 0,
  resetsAt: "",
  pctUsed: -1,
  resetLabel: "",
};

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

/**
 * One rolling window row (session / week). The right-hand value + bar reflect the
 * plan-limit % from the CLI's `/usage`:
 *  - `loading`     → skeleton (the % is being fetched in the background),
 *  - `ready`       → "N% used" + a filled gauge (width = pctUsed),
 *  - `unavailable` → fall back to the window's cost + a faint bar.
 * The sub-line always shows real tokens · requests · cost · resets.
 */
function UsageRow({
  label,
  window,
  resetsAsDate,
  status,
}: {
  label: string;
  window: UsageWindow;
  resetsAsDate?: boolean;
  status: ClaudeStats["limitsStatus"];
}) {
  const loading = status === "loading";
  const hasPct = window.pctUsed >= 0;
  const pct = Math.max(0, Math.min(100, window.pctUsed));
  // Prefer the CLI's authoritative (already-localized) reset label; else format the ISO.
  const reset =
    window.resetLabel || (resetsAsDate ? fmtDateTime(window.resetsAt) : fmtTime(window.resetsAt));
  const sub = `${fmtTokens(window.tokens)} tokens · ${window.requests} requests · ${fmtCost(
    window.costUsd,
  )}${reset ? ` · resets ${reset}` : ""}`;

  return (
    <div className="mt-[15px]">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-ink-soft">{label}</span>
        {loading ? (
          <span className="h-3 w-14 animate-pulse rounded bg-white/[0.12]" />
        ) : hasPct ? (
          <span className="text-[12px] font-bold text-ink">{pct}% used</span>
        ) : (
          <span className="text-[12px] font-bold text-ink">{fmtCost(window.costUsd)}</span>
        )}
      </div>

      {loading ? (
        <div className="mt-2 h-[6px] w-full animate-pulse rounded-full bg-white/[0.12]" />
      ) : hasPct ? (
        <div className="mt-2 h-[6px] w-full overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className="h-full rounded-full"
            style={{
              width: `${pct}%`,
              background: "linear-gradient(90deg,#8b5cf6,#22d3ee)",
              transition: "width .5s cubic-bezier(.2,.8,.2,1)",
            }}
          />
        </div>
      ) : (
        <div className="mt-2 h-[3px] w-full rounded-full bg-white/[0.06]" />
      )}

      {loading ? (
        <div className="mt-2 h-2.5 w-3/4 animate-pulse rounded bg-white/[0.08]" />
      ) : (
        <div className="mt-1.5 text-[10.5px] text-ink-dim">{sub}</div>
      )}
    </div>
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
  const refresh = useRefreshAiStats();
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

  const short = shortModel(stats.modelLabel);
  const limitsStatus = stats.limitsStatus ?? "unavailable";
  const session = stats.session ?? EMPTY_WINDOW;
  const week = stats.week ?? EMPTY_WINDOW;
  const bd = stats.breakdown ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const byModel: ByModelUsage[] = stats.byModel ?? [];

  const breakdown: Array<[string, number, string]> = [
    ["Input", bd.input, "#a78bfa"],
    ["Output", bd.output, "#22d3ee"],
    ["Cache read", bd.cacheRead, "#34d399"],
    ["Cache write", bd.cacheWrite, "#fbbf24"],
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
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: stats.operational ? "#34d399" : "#f43f5e" }}
            />
            {stats.operational ? "Operational" : "Unavailable"}
          </div>
        </div>
        <Pill color="#c4b5fd" bg="rgba(139,92,246,.16)">
          {stats.ctxWindow} ctx
        </Pill>
        <button
          type="button"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          title="Refresh stats"
          aria-label="Refresh stats"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.05] text-ink-soft hover:bg-white/[0.1] disabled:opacity-70"
        >
          <RefreshCw
            size={13}
            strokeWidth={2}
            className={refresh.isPending || limitsStatus === "loading" ? "animate-spin" : ""}
          />
        </button>
      </div>

      {/* Rolling windows */}
      <UsageRow label="Current session" window={session} status={limitsStatus} />
      <UsageRow label="Current week" window={week} resetsAsDate status={limitsStatus} />

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

      {/* By model — only when more than one model has usage */}
      {byModel.length > 1 && (
        <>
          <div className="mt-[15px] mb-[7px] text-[9px] font-bold tracking-[0.1em] text-ink-dim">
            BY MODEL
          </div>
          <div className="flex flex-col gap-1.5">
            {byModel.map((m) => (
              <div key={m.model} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] text-ink-soft">
                  {m.modelLabel}
                </span>
                <span className="text-[10px] text-ink-dim">
                  {fmtTokens(m.input + m.output + m.cacheRead + m.cacheWrite)} tokens
                </span>
                <span className="font-mono text-[11px] font-semibold text-ink">
                  {fmtCost(m.costUsd)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Estimate disclaimer — cost is computed from token counts × model pricing
          (per-message cost isn't recorded), aggregated from local Claude sessions. */}
      <div className="mt-[13px] flex items-start gap-1.5 text-[10px] leading-[1.45] text-ink-dim">
        <Info size={12} strokeWidth={2} className="mt-px shrink-0" />
        <span>
          Estimated — costs are computed from token usage × model pricing, from local
          Claude sessions on this machine.
        </span>
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
