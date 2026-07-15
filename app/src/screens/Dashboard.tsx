import { motion } from "framer-motion";
import { useState, type PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Check, Clock, LayoutList, Sparkles, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { CountUp } from "@/components/ui/CountUp";
import { Spinner } from "@/components/ui/misc";
import { useTilt } from "@/hooks/useTilt";
import { TiltSweep } from "@/components/ui/TiltSweep";
import { runColor, runEffectiveStatus, runMeta, runRateLabel, timeAgo } from "@/components/dashboard/runStatus";
import { useAuditEvents, useReports, useRunCases, useRuns } from "@/hooks/queries";
import { useAuth } from "@/store/auth";
import { useUI } from "@/store/ui";

const initials = (name: string) =>
  name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

// Icon-chip colours per actor type, matching the design palette.
const ACTOR_BG: Record<string, string> = {
  ai: "rgba(139,92,246,.16)",
  user: "rgba(16,185,129,.14)",
  system: "rgba(147,197,253,.16)",
};
const ACTOR_FG: Record<string, string> = {
  ai: "#a78bfa",
  user: "#6ee7b7",
  system: "#93c5fd",
};

export function Dashboard() {
  const navigate = useNavigate();
  const heroTilt = useTilt();
  // Bumped on each hover-enter to remount (and replay) the hero's shine sweep.
  const [heroSweepKey, setHeroSweepKey] = useState(0);
  const replayHeroSweep = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType !== "touch") setHeroSweepKey((k) => k + 1);
  };
  const { data: runs, isLoading: runsLoading } = useRuns();
  const openCreateRun = useUI((s) => s.openCreateRun);
  // Runs sorted newest-first; the hero card displays the most recent run.
  const recentRuns = [...(runs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  const heroRun = recentRuns[0] ?? null;
  const { data: activeRunCases } = useRunCases(heroRun?.id ?? null);
  const { data: reports } = useReports();
  const { data: activity } = useAuditEvents({});
  const user = useAuth((s) => s.user);
  const firstName = user?.firstName?.trim() ?? "";

  // Aggregate real report metrics; show em dash when no reports exist yet.
  const reportCount = reports?.length ?? 0;
  const passRateLabel = reportCount
    ? `${(reports!.reduce((sum, r) => sum + r.passRate, 0) / reportCount).toFixed(1)}%`
    : "—";
  const avgRuntimeLabel = reportCount
    ? `${Math.round(reports!.reduce((sum, r) => sum + r.durationS, 0) / reportCount)}s`
    : "—";
  const acrossLabel = reportCount ? `across ${reportCount} report${reportCount === 1 ? "" : "s"}` : "no reports yet";

  // Suite health ring — aggregate pass/fail across all real reports.
  const suitePassed = reports?.reduce((sum, r) => sum + r.passed, 0) ?? 0;
  const suiteFailed = reports?.reduce((sum, r) => sum + r.failed, 0) ?? 0;
  const suiteTotal = suitePassed + suiteFailed;
  const suitePassRate = suiteTotal ? (suitePassed / suiteTotal) * 100 : null;
  const suiteRingOffset = suitePassRate == null ? 377 : Math.round(377 - (377 * suitePassRate) / 100);

  const activeRuns = runs?.filter((r) => r.status !== "done") ?? [];
  const reviewRuns = runs?.filter((r) => r.status === "review") ?? [];
  const casesInReview = activeRunCases?.filter((c) => c.approval === "pending").length ?? 0;

  const stats = [
    {
      label: "Active runs",
      value: runsLoading ? "—" : String(activeRuns.length),
      trend: reviewRuns[0] ? `${reviewRuns[0].code} in review` : "All caught up",
      trendColor: "#fbbf24",
      color: "#a78bfa",
      icon: <LayoutList size={17} strokeWidth={2} />,
    },
    {
      label: "Cases in review",
      value: heroRun ? String(casesInReview) : "—",
      trend: heroRun ? `in ${heroRun.code}` : "no runs yet",
      trendColor: "#6ee7b7",
      color: "#22d3ee",
      icon: <CheckCircle2 size={17} strokeWidth={2} />,
    },
    // Derived from real report data via useReports() (see api.listReports()).
    {
      label: "Pass rate",
      value: passRateLabel,
      trend: acrossLabel,
      trendColor: "#6ee7b7",
      color: "#8b5cf6",
      icon: <TrendingUp size={17} strokeWidth={2} />,
    },
    {
      label: "Avg runtime",
      value: avgRuntimeLabel,
      trend: acrossLabel,
      trendColor: "#6ee7b7",
      color: "#f59e0b",
      icon: <Clock size={17} strokeWidth={2} />,
    },
  ];

  return (
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-muted">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}{" "}
            · Good morning{firstName ? `, ${firstName}` : ""}
          </div>
          <h1 className="m-0 text-[26px] font-black tracking-tight md:text-[32px]">Mission control</h1>
        </div>
        {reviewRuns.length > 0 && (
          <div
            className="flex items-center gap-2 rounded-xl px-3.5 py-2"
            style={{ background: "rgba(245,158,11,.1)", border: "1px solid rgba(245,158,11,.25)" }}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "#f59e0b", animation: "pulseDot 1.8s infinite" }}
            />
            <span className="text-[12.5px] font-semibold text-[#fbbf24]">
              {reviewRuns.length} run{reviewRuns.length === 1 ? "" : "s"} in review
            </span>
          </div>
        )}
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        {stats.map((s, i) => (
          <GlassCard key={s.label} hover index={i} className="p-[18px]">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-[#9494a6]">{s.label}</span>
              <span style={{ color: s.color }}>{s.icon}</span>
            </div>
            <CountUp
              value={s.value}
              className="block text-[29px] font-black leading-none tracking-tight"
            />
            <div className="mt-2 text-[12px] font-semibold" style={{ color: s.trendColor }}>
              {s.trend}
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3.5 md:grid-cols-[1.55fr_1fr]">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          whileHover={{ zIndex: 20 }}
          onPointerEnter={replayHeroSweep}
          onPointerMove={heroTilt.onPointerMove}
          onPointerLeave={heroTilt.onPointerLeave}
          className="relative overflow-hidden rounded-[22px] p-[18px] md:p-[26px]"
          style={{
            ...heroTilt.style,
            background: "linear-gradient(135deg,rgba(139,92,246,.2),rgba(99,102,241,.09))",
            border: "1px solid rgba(139,92,246,.26)",
          }}
        >
          <div
            className="pointer-events-none absolute -right-[30px] -top-10 h-[220px] w-[220px] rounded-full"
            style={{
              background: "radial-gradient(circle,rgba(139,92,246,.4),transparent 65%)",
              filter: "blur(20px)",
            }}
          />
          <div className="relative">
            <div
              className="mb-4 inline-flex items-center gap-[7px] rounded-[20px] px-[11px] py-[5px] text-[11.5px] font-semibold"
              style={{ background: "rgba(255,255,255,.08)" }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  background: heroRun ? runColor(runEffectiveStatus(heroRun)) : "#22d3ee",
                  animation: "pulseDot 1.5s infinite",
                }}
              />
              {heroRun ? `${heroRun.code} · ${heroRun.status.toUpperCase()}` : "NO ACTIVE RUN"}
            </div>
            <h2 className="m-0 mb-2 max-w-[440px] text-[23px] font-extrabold tracking-tight">
              {heroRun ? heroRun.name : "Run a whole sprint through one QA pipeline"}
            </h2>
            <p className="m-0 mb-5 max-w-[440px] text-[14px] leading-relaxed text-[#c3c3d4]">
              {heroRun
                ? `${runMeta(heroRun)} — in the ${heroRun.status} stage. Review cases, run Playwright in parallel, and publish evidence back to every ticket.`
                : "Select tickets, batch-generate test cases, review like pull requests, run Playwright in parallel, then publish evidence back to every ticket."}
            </p>
            <div className="flex gap-2.5">
              {heroRun ? (
                <Button
                  variant="white"
                  size="lg"
                  onClick={() => navigate(`/runs/${heroRun.id}`)}
                >
                  <Check size={16} strokeWidth={2.3} /> Open run
                </Button>
              ) : (
                <Button variant="white" size="lg" onClick={openCreateRun}>
                  <Check size={16} strokeWidth={2.3} /> New Run
                </Button>
              )}
              <Button
                variant="glass"
                size="lg"
                onClick={() => navigate(heroRun ? `/runs/${heroRun.id}/review` : "/runs")}
              >
                Review Center
              </Button>
            </div>
          </div>
          {heroSweepKey > 0 && <TiltSweep key={heroSweepKey} />}
        </motion.div>

        <GlassCard className="flex flex-col p-[22px]">
          <div className="mb-1.5 text-[13px] font-semibold text-[#c7c7d4]">Suite health · 7d</div>
          {/* No aggregate suite-health endpoint yet — decorative per design. */}
          <div className="relative flex flex-1 items-center justify-center">
            <svg width="150" height="150" viewBox="0 0 150 150">
              <circle cx="75" cy="75" r="60" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="13" />
              <circle
                cx="75"
                cy="75"
                r="60"
                fill="none"
                stroke="url(#dashRingGrad)"
                strokeWidth="13"
                strokeLinecap="round"
                strokeDasharray="377"
                strokeDashoffset={suiteRingOffset}
                transform="rotate(-90 75 75)"
              />
              <defs>
                <linearGradient id="dashRingGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#22d3ee" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute text-center">
              <div className="text-[34px] font-black tracking-tight">
                {suitePassRate == null ? "—" : `${suitePassRate.toFixed(1)}%`}
              </div>
              <div className="text-[11.5px] font-medium text-muted">pass rate</div>
            </div>
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
            <span>
              <span className="font-bold text-[#10b981]">{suitePassed.toLocaleString()}</span> passed
            </span>
            <span>
              <span className="font-bold text-[#f43f5e]">{suiteFailed.toLocaleString()}</span> failed
            </span>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
        <GlassCard className="p-5">
          <div className="mb-4 text-[15px] font-bold">Recent activity</div>
          <div className="flex flex-col gap-0.5">
            {(activity ?? []).length === 0 ? (
              <p className="m-0 px-1.5 py-3 text-[12.5px] text-ink-dim">
                No activity yet — actions you take will show up here.
              </p>
            ) : (
              (activity ?? []).slice(0, 5).map((e) => (
                <div
                  key={e.id}
                  className="flex gap-[13px] rounded-xl px-1.5 py-2.5 hover:bg-white/[0.04]"
                >
                  <div
                    className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
                    style={{ background: ACTOR_BG[e.actorType] ?? ACTOR_BG.system }}
                  >
                    {e.actorType === "ai" ? (
                      <Sparkles size={15} color={ACTOR_FG.ai} strokeWidth={2.2} />
                    ) : (
                      <span
                        className="text-[10px] font-bold"
                        style={{ color: ACTOR_FG[e.actorType] ?? ACTOR_FG.system }}
                      >
                        {initials(e.actor)}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-[#dcdce4]">
                      <span className="font-bold">{e.actor}</span> {e.action}
                      {e.target ? ` · ${e.target}` : ""}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-[#7a7a8c]">{timeAgo(e.ts)}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center">
            <span className="flex-1 text-[15px] font-bold">Recent runs</span>
            <button
              onClick={() => navigate("/runs")}
              className="cursor-pointer border-none bg-transparent text-[12.5px] font-semibold text-[#a78bfa]"
            >
              View all
            </button>
          </div>
          {runsLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : recentRuns.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-6 text-center">
              <Sparkles size={20} className="text-muted" />
              <p className="m-0 text-[12.5px] text-ink-dim">No runs yet — create one to get started.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-[9px]">
              {recentRuns.slice(0, 4).map((r) => {
                const color = runColor(runEffectiveStatus(r));
                return (
                  <div
                    key={r.id}
                    onClick={() => navigate(`/runs/${r.id}`)}
                    className="flex cursor-pointer items-center gap-3 rounded-[14px] p-3"
                    style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.05)" }}
                  >
                    <span
                      className="h-[9px] w-[9px] shrink-0 rounded-full"
                      style={{ background: color, boxShadow: `0 0 10px ${color}` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">
                        {r.code} · {r.name}
                      </div>
                      <div className="font-mono text-[11px] text-[#7a7a8c]">{runMeta(r)}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-extrabold" style={{ color }}>
                        {runRateLabel(runEffectiveStatus(r))}
                      </div>
                      <div className="text-[10.5px] text-[#7a7a8c]">{timeAgo(r.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
