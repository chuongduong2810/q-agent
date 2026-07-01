import { motion } from "framer-motion";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/misc";
import { runColor, timeAgo } from "@/components/dashboard/runStatus";
import { useReports, useRuns } from "@/hooks/queries";
import { useUI } from "@/store/ui";

/** Design's showcase 7-day trend bars — used when no run report carries a
 * `data.trend` series yet (no aggregate reporting endpoint exists across
 * runs, see docs/API-CONTRACT.md `GET /reports`). Values are bar heights
 * (0-1) with the day label, matching Q-Agent.dc.html lines 514. */
const SHOWCASE_TREND = [
  { d: "Wed", v: 0.72 },
  { d: "Thu", v: 0.81 },
  { d: "Fri", v: 0.68 },
  { d: "Sat", v: 0.9 },
  { d: "Sun", v: 0.85 },
  { d: "Mon", v: 0.94 },
  { d: "Tue", v: 0.97 },
];

/** Design's showcase flaky-tests list — no `data.flaky` on the latest report
 * falls back to this (Q-Agent.dc.html line 519). */
const SHOWCASE_FLAKY = [
  { id: "TC-14", name: "Checkout — apply promo code", runs: "3 of last 10 runs", rate: "70%" },
  { id: "TC-22", name: "Login — SSO redirect timing", runs: "2 of last 10 runs", rate: "80%" },
  { id: "TC-09", name: "Cart — quantity stepper race", runs: "4 of last 10 runs", rate: "60%" },
];

export function Reports() {
  const { data: reports, isLoading: reportsLoading } = useReports();
  const { data: runs, isLoading: runsLoading } = useRuns();
  const setActiveRun = useUI((s) => s.setActiveRun);
  const navigate = useUI((s) => s.navigate);

  // Latest report (by createdAt) backs the summary cards; fall back to the
  // design's showcase numbers when no run has been reported on yet.
  const latest = reports?.length
    ? [...reports].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
    : null;
  const passRate = latest ? latest.passRate : 94.2;
  const trend = (latest?.data?.trend as { d: string; v: number }[] | undefined) ?? SHOWCASE_TREND;
  const flaky = (latest?.data?.flaky as typeof SHOWCASE_FLAKY | undefined) ?? SHOWCASE_FLAKY;
  const avgDuration = latest ? `${Math.round(latest.durationS / 60)}m ${Math.round(latest.durationS % 60)}s` : "4m 12s";
  const flakyRate = (latest?.data?.flakyRate as string | undefined) ?? "3.1%";

  const recentRuns = [...(runs ?? [])]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 4);

  const ringOffset = 377 - (377 * Math.max(0, Math.min(100, passRate))) / 100;

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-[22px] flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-muted">Last 7 days · across all runs</div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Reports</h1>
        </div>
        <Button onClick={() => toast("Report exported")}>
          <Download size={15} /> Export
        </Button>
      </div>

      <div className="mb-3.5 grid grid-cols-[.9fr_1.5fr_.9fr] gap-3.5">
        <GlassCard className="flex flex-col items-center justify-center gap-3.5 p-5">
          <div className="relative h-[150px] w-[150px]">
            <svg width="150" height="150" viewBox="0 0 150 150">
              <circle cx="75" cy="75" r="60" fill="none" stroke="rgba(255,255,255,.07)" strokeWidth="13" />
              <circle
                cx="75"
                cy="75"
                r="60"
                fill="none"
                stroke="url(#reportsRingGrad)"
                strokeWidth="13"
                strokeLinecap="round"
                strokeDasharray="377"
                strokeDashoffset={ringOffset}
                transform="rotate(-90 75 75)"
                style={{ transition: "stroke-dashoffset .4s ease" }}
              />
              <defs>
                <linearGradient id="reportsRingGrad" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#22d3ee" />
                  <stop offset="1" stopColor="#8b5cf6" />
                </linearGradient>
              </defs>
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <div className="text-[32px] font-black leading-none tracking-tight">{passRate.toFixed(1)}%</div>
              <div className="mt-0.5 text-[11.5px] text-muted">pass rate</div>
            </div>
          </div>
          <div className="text-[12px] font-semibold text-[#6ee7b7]">&#9650; 2.1% vs last week</div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-[18px] text-[14px] font-bold">Pass rate trend</div>
          <div className="relative flex h-[150px] items-end gap-3 pb-6">
            {trend.map((b) => (
              <div key={b.d} className="flex h-full flex-1 flex-col items-center justify-end gap-2">
                <motion.div
                  initial={{ scaleY: 0.02 }}
                  animate={{ scaleY: b.v }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                  className="w-full max-w-[34px] origin-bottom rounded-[8px_8px_3px_3px]"
                  style={{ height: "100%", background: "linear-gradient(180deg,#8b5cf6,#6366f1)" }}
                />
                <span className="absolute bottom-0 text-[11px] text-[#7a7a8c]">{b.d}</span>
              </div>
            ))}
          </div>
        </GlassCard>

        <div className="flex flex-col gap-3.5">
          <GlassCard className="flex-1 p-[18px]">
            <div className="mb-2 text-[12.5px] text-[#9494a6]">Avg run duration</div>
            <div className="text-[28px] font-black tracking-tight">{avgDuration}</div>
            <div className="mt-1.5 text-[12px] font-semibold text-[#6ee7b7]">&#9660; parallelised</div>
          </GlassCard>
          <GlassCard className="flex-1 p-[18px]">
            <div className="mb-2 text-[12.5px] text-[#9494a6]">Flaky rate</div>
            <div className="text-[28px] font-black tracking-tight">{flakyRate}</div>
            <div className="mt-1.5 text-[12px] font-semibold text-[#fb7185]">&#9650; watch {flaky.length} cases</div>
          </GlassCard>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3.5">
        <GlassCard className="p-5">
          <div className="mb-4 text-[15px] font-bold">Recent runs</div>
          {runsLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : recentRuns.length === 0 ? (
            <p className="m-0 py-6 text-center text-[12.5px] text-ink-dim">No runs yet.</p>
          ) : (
            <div className="flex flex-col gap-[9px]">
              {recentRuns.map((r) => {
                const color = runColor(r.status);
                return (
                  <div
                    key={r.id}
                    onClick={() => {
                      setActiveRun(r.id);
                      navigate("run");
                    }}
                    className="flex cursor-pointer items-center gap-3 rounded-[13px] p-3"
                    style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.05)" }}
                  >
                    <span
                      className="h-[9px] w-[9px] shrink-0 rounded-full"
                      style={{ background: color, boxShadow: `0 0 8px ${color}` }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold">
                        {r.code} · {r.name}
                      </div>
                      <div className="font-mono text-[11px] text-[#7a7a8c]">{r.ticketIds.length} tickets</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[13px] font-extrabold" style={{ color }}>
                        {r.status === "done" ? "Done" : "In progress"}
                      </div>
                      <div className="text-[10.5px] text-[#7a7a8c]">{timeAgo(r.createdAt)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </GlassCard>

        <GlassCard className="p-5">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex-1 text-[15px] font-bold">Flaky tests</span>
            <span className="rounded-full px-[9px] py-[3px] text-[11px] font-semibold text-[#fbbf24]" style={{ background: "rgba(251,191,36,.13)" }}>
              Needs attention
            </span>
          </div>
          {reportsLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : (
            <div className="flex flex-col gap-[9px]">
              {flaky.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center gap-3 rounded-[13px] p-3"
                  style={{ background: "rgba(255,255,255,.03)", border: "1px solid rgba(255,255,255,.05)" }}
                >
                  <span className="font-mono text-[11.5px] font-semibold text-[#a78bfa]">{f.id}</span>
                  <span className="flex-1 text-[13px] text-[#dcdce4]">{f.name}</span>
                  <span className="text-[11px] text-[#7a7a8c]">{f.runs}</span>
                  <span className="text-[13px] font-extrabold text-[#fbbf24]">{f.rate}</span>
                </div>
              ))}
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
