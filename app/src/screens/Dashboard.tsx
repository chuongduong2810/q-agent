import { motion } from "framer-motion";
import { CheckCircle2, Check, Clock, LayoutList, Sparkles, TrendingUp } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/misc";
import { runColor, runMeta, runRateLabel, timeAgo } from "@/components/dashboard/runStatus";
import { useRunCases, useRuns } from "@/hooks/queries";
import { useUI } from "@/store/ui";

/** Design's showcase "Recent activity" feed — no backend endpoint exists for
 * an activity log, so these entries are kept as static decoration per the
 * frozen design (Q-Agent.dc.html lines 798-803). */
const ACTIVITY = [
  {
    who: "Q-Agent",
    what: "generated 21 test cases across RUN-204",
    when: "3 minutes ago",
    bg: "rgba(139,92,246,.16)",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
      </svg>
    ),
  },
  {
    who: "Maya Kaur",
    what: "approved 10 cases in SUR-1428",
    when: "8 minutes ago",
    bg: "rgba(16,185,129,.14)",
    icon: <Check size={15} color="#6ee7b7" strokeWidth={2.4} />,
  },
  {
    who: "RUN-201",
    what: "full regression finished — 96% pass",
    when: "1 day ago",
    bg: "rgba(34,211,238,.14)",
    icon: <LayoutList size={15} color="#67e8f9" strokeWidth={2.2} />,
  },
  {
    who: "Azure DevOps",
    what: "synced 5 tickets from Sprint 24",
    when: "1 day ago",
    bg: "rgba(0,120,212,.18)",
    icon: (
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4aa3ff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M23 4v6h-6" />
        <path d="M3.5 9a9 9 0 0 1 14.8-3.4L23 10" />
      </svg>
    ),
  },
];

export function Dashboard() {
  const { data: runs, isLoading: runsLoading } = useRuns();
  const activeRunId = useUI((s) => s.activeRunId);
  const navigate = useUI((s) => s.navigate);
  const openCreateRun = useUI((s) => s.openCreateRun);
  const setActiveRun = useUI((s) => s.setActiveRun);
  const { data: activeRunCases } = useRunCases(activeRunId);

  const activeRuns = runs?.filter((r) => r.status !== "done") ?? [];
  const reviewRuns = runs?.filter((r) => r.status === "review") ?? [];
  const casesInReview = activeRunCases?.filter((c) => c.approval === "pending").length ?? 0;
  const recentRuns = [...(runs ?? [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

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
      value: activeRunId ? String(casesInReview) : "—",
      trend: activeRunId ? "in the active run" : "no active run",
      trendColor: "#6ee7b7",
      color: "#22d3ee",
      icon: <CheckCircle2 size={17} strokeWidth={2} />,
    },
    // No aggregate pass-rate / runtime endpoint exists yet — keep the design's
    // showcase values (see docs/API-CONTRACT.md, no /stats route).
    {
      label: "Pass rate",
      value: "94.2%",
      trend: "+2.1% vs last run",
      trendColor: "#6ee7b7",
      color: "#8b5cf6",
      icon: <TrendingUp size={17} strokeWidth={2} />,
    },
    {
      label: "Avg runtime",
      value: "32.2s",
      trend: "−4.8s optimised",
      trendColor: "#6ee7b7",
      color: "#f59e0b",
      icon: <Clock size={17} strokeWidth={2} />,
    },
  ];

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-muted">
            Wednesday, July 1 · Good morning, Maya
          </div>
          <h1 className="m-0 text-[32px] font-black tracking-tight">Mission control</h1>
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

      <div className="mb-4 grid grid-cols-4 gap-3.5">
        {stats.map((s, i) => (
          <GlassCard key={s.label} hover index={i} className="p-[18px]">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-[12.5px] font-medium text-[#9494a6]">{s.label}</span>
              <span style={{ color: s.color }}>{s.icon}</span>
            </div>
            <div className="text-[29px] font-black leading-none tracking-tight">{s.value}</div>
            <div className="mt-2 text-[12px] font-semibold" style={{ color: s.trendColor }}>
              {s.trend}
            </div>
          </GlassCard>
        ))}
      </div>

      <div className="mb-4 grid grid-cols-[1.55fr_1fr] gap-3.5">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="relative overflow-hidden rounded-[22px] p-[26px]"
          style={{
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
                style={{ background: "#22d3ee", animation: "pulseDot 1.5s infinite" }}
              />
              RUN-204 · SPRINT 24
            </div>
            <h2 className="m-0 mb-2 max-w-[440px] text-[23px] font-extrabold tracking-tight">
              Run a whole sprint through one QA pipeline
            </h2>
            <p className="m-0 mb-5 max-w-[440px] text-[14px] leading-relaxed text-[#c3c3d4]">
              Select tickets, batch-generate Azure DevOps test cases, review like pull requests,
              run Playwright in parallel, then publish evidence back to every ticket.
            </p>
            <div className="flex gap-2.5">
              <Button variant="white" size="lg" onClick={() => navigate("review")}>
                <Check size={16} strokeWidth={2.3} /> Open Review Center
              </Button>
              <Button variant="glass" size="lg" onClick={openCreateRun}>
                New Run
              </Button>
            </div>
          </div>
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
                strokeDashoffset="22"
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
              <div className="text-[34px] font-black tracking-tight">94.2%</div>
              <div className="text-[11.5px] font-medium text-muted">pass rate</div>
            </div>
          </div>
          <div className="mt-1.5 flex justify-between text-[11.5px] text-muted">
            <span>
              <span className="font-bold text-[#10b981]">1,204</span> passed
            </span>
            <span>
              <span className="font-bold text-[#f43f5e]">74</span> failed
            </span>
          </div>
        </GlassCard>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <GlassCard className="p-5">
          <div className="mb-4 text-[15px] font-bold">Recent activity</div>
          <div className="flex flex-col gap-0.5">
            {ACTIVITY.map((a) => (
              <div
                key={a.who + a.when}
                className="flex gap-[13px] rounded-xl px-1.5 py-2.5 hover:bg-white/[0.04]"
              >
                <div
                  className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
                  style={{ background: a.bg }}
                >
                  {a.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-[#dcdce4]">
                    <span className="font-bold">{a.who}</span> {a.what}
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#7a7a8c]">{a.when}</div>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center">
            <span className="flex-1 text-[15px] font-bold">Recent runs</span>
            <button
              onClick={() => navigate("runs")}
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
                const color = runColor(r.status);
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setActiveRun(r.id);
                      navigate("run");
                    }}
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
                        {runRateLabel(r.status)}
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
