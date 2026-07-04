import { useMemo, useState } from "react";
import { ChevronRight, Download, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  useAuditEvents,
  useAuditStats,
  useBackendLogs,
  useBackendLogStats,
  useClearAuditEvents,
} from "@/hooks/queries";
import type { AuditEventOut } from "@/types/api";

// Colour maps copied verbatim from the design export.
const CAT: Record<string, [string, string, string]> = {
  ai: ["AI", "#a78bfa", "rgba(139,92,246,.14)"],
  sync: ["Sync", "#67e8f9", "rgba(34,211,238,.13)"],
  review: ["Review", "#6ee7b7", "rgba(16,185,129,.14)"],
  execution: ["Execution", "#fbbf24", "rgba(251,191,36,.13)"],
  auth: ["Auth", "#f9a8d4", "rgba(244,114,182,.14)"],
  knowledge: ["Knowledge", "#c4b5fd", "rgba(196,181,253,.14)"],
  integration: ["Integration", "#93c5fd", "rgba(147,197,253,.14)"],
  run: ["Run", "#fca5a5", "rgba(252,165,165,.13)"],
  comment: ["Comment", "#5eead4", "rgba(94,234,212,.13)"],
  settings: ["Settings", "#d4d4d8", "rgba(212,212,216,.12)"],
};
const ACTOR: Record<string, [string, string]> = {
  user: ["#c4b5fd", "rgba(139,92,246,.16)"],
  ai: ["#a78bfa", "linear-gradient(135deg,#8b5cf6,#6366f1)"],
  system: ["#93c5fd", "rgba(147,197,253,.16)"],
};
const STATUS: Record<string, [string, string, string]> = {
  success: ["#6ee7b7", "rgba(16,185,129,.14)", "Success"],
  warning: ["#fbbf24", "rgba(251,191,36,.13)", "Warning"],
  error: ["#fb7185", "rgba(244,63,94,.14)", "Failed"],
};
const LEVEL: Record<string, [string, string, string]> = {
  info: ["INFO", "#6ee7b7", "rgba(16,185,129,.14)"],
  warn: ["WARN", "#fbbf24", "rgba(251,191,36,.14)"],
  error: ["ERROR", "#fb7185", "rgba(244,63,94,.16)"],
  debug: ["DEBUG", "#93c5fd", "rgba(147,197,253,.14)"],
};

const CAT_CHIPS: Array<[string, string]> = [
  ["all", "All events"], ["ai", "AI"], ["sync", "Sync"], ["review", "Review"],
  ["execution", "Execution"], ["auth", "Auth"], ["integration", "Integration"], ["settings", "Settings"],
];
const ACTOR_CHIPS: Array<[string, string]> = [
  ["all", "Everyone"], ["user", "People"], ["ai", "Q-Agent"], ["system", "System"],
];
const LEVEL_CHIPS: Array<[string, string]> = [
  ["all", "All"], ["info", "Info"], ["warn", "Warn"], ["error", "Error"], ["debug", "Debug"],
];

const panel: React.CSSProperties = {
  background: "rgba(255,255,255,.035)",
  backdropFilter: "blur(22px)",
  WebkitBackdropFilter: "blur(22px)",
  border: "1px solid rgba(255,255,255,.07)",
};

function chipStyle(active: boolean, accent: "violet" | "cyan"): React.CSSProperties {
  if (!active) return { background: "rgba(255,255,255,.05)", color: "#a0a0b2" };
  return accent === "violet"
    ? { background: "rgba(139,92,246,.2)", color: "#fff", boxShadow: "inset 0 0 0 1px rgba(139,92,246,.3)" }
    : { background: "rgba(34,211,238,.16)", color: "#67e8f9", boxShadow: "inset 0 0 0 1px rgba(34,211,238,.3)" };
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={panel} className="rounded-2xl px-[18px] py-4">
      <div className="mb-2 text-[12px] text-[#9494a6]">{label}</div>
      <div className="text-[24px] font-black tracking-tight" style={{ color }}>{value}</div>
    </div>
  );
}

const initials = (name: string) =>
  name.split(" ").map((x) => x[0]).join("").slice(0, 2).toUpperCase();

function toCsv(events: AuditEventOut[]): string {
  const head = ["id", "ts", "category", "actor", "actorType", "action", "target", "ip", "status", "meta"];
  const esc = (v: string) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = events.map((e) => head.map((k) => esc((e as unknown as Record<string, string>)[k])).join(","));
  return [head.join(","), ...rows].join("\n");
}

export function AuditLog() {
  const [view, setView] = useState<"activity" | "backend">("activity");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [actor, setActor] = useState("all");
  const [level, setLevel] = useState("all");
  const [service, setService] = useState("all");
  const [liveTail, setLiveTail] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const q = search.trim() || undefined;
  const { data: events } = useAuditEvents({
    category: category === "all" ? undefined : category,
    actor: actor === "all" ? undefined : actor,
    q,
  });
  const { data: stats } = useAuditStats();
  const { data: logs } = useBackendLogs(
    { level: level === "all" ? undefined : level, service: service === "all" ? undefined : service, q },
    view === "backend" && liveTail,
  );
  const { data: logStats } = useBackendLogStats(view === "backend" && liveTail);
  const clearEvents = useClearAuditEvents();

  const clearAll = () => {
    if (!window.confirm("Delete all audit events? This clears the audit_logs table and cannot be undone.")) return;
    clearEvents.mutate(undefined, {
      onSuccess: (r) => toast.success(`Cleared ${r.deleted} audit event${r.deleted === 1 ? "" : "s"}`),
      onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to clear audit log"),
    });
  };

  const rows = events ?? [];
  const logRows = logs ?? [];
  const services = useMemo(
    () => Array.from(new Set((logs ?? []).map((l) => l.service))).sort(),
    [logs],
  );

  const exportCsv = () => {
    const blob = new Blob([toCsv(rows)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "audit-log.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="animate-fade-in-up px-1 pb-10 pt-0.5">
      <div className="mb-[18px] flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-[#8b8b9e]">
            Every app event, user action and AI operation &middot; retained 90 days
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Audit Log</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportCsv}
            className="flex items-center gap-[7px] rounded-xl border border-white/[0.09] bg-white/[0.05] px-[15px] py-2.5 text-[13px] font-semibold text-[#dcdce4] hover:bg-white/[0.1]"
          >
            <Download size={15} /> Export CSV
          </button>
          <button
            onClick={clearAll}
            disabled={clearEvents.isPending || rows.length === 0}
            className="flex items-center gap-[7px] rounded-xl border border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.13)] px-[15px] py-2.5 text-[13px] font-semibold text-[#fb7185] hover:bg-[rgba(244,63,94,.2)] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={15} /> {clearEvents.isPending ? "Clearing…" : "Clear log"}
          </button>
        </div>
      </div>

      <div className="mb-4 flex gap-2">
        {(["activity", "backend"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className="rounded-[11px] px-4 py-2 text-[13px] font-semibold"
            style={
              view === v
                ? {
                    background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))",
                    color: "#fff",
                    boxShadow: "inset 0 0 0 1px rgba(139,92,246,.3)",
                  }
                : { background: "rgba(255,255,255,.04)", color: "#a0a0b2" }
            }
          >
            {v === "activity" ? "Activity" : "Backend Logs"}
          </button>
        ))}
      </div>

      {view === "activity" ? (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3.5">
            <StatCard label="Events today" value={String(stats?.eventsToday ?? 0)} color="#a78bfa" />
            <StatCard label="AI actions" value={String(stats?.aiActions ?? 0)} color="#67e8f9" />
            <StatCard label="User actions" value={String(stats?.userActions ?? 0)} color="#6ee7b7" />
            <StatCard label="Failed / warnings" value={String(stats?.failures ?? 0)} color="#fb7185" />
          </div>

          <div style={panel} className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3">
            <div className="flex h-9 min-w-[200px] max-w-[300px] flex-1 items-center gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.04] px-3">
              <Search size={14} className="text-[#7a7a8c]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search events, actors, targets…"
                className="flex-1 bg-transparent text-[13px] text-ink outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-[7px]">
              {ACTOR_CHIPS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setActor(id)}
                  className="rounded-[10px] px-[13px] py-[7px] text-[12.5px] font-semibold"
                  style={chipStyle(actor === id, "cyan")}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-4 flex flex-wrap gap-[7px]">
            {CAT_CHIPS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setCategory(id)}
                className="whitespace-nowrap rounded-[10px] px-[13px] py-[7px] text-[12.5px] font-semibold"
                style={chipStyle(category === id, "violet")}
              >
                {label}
              </button>
            ))}
          </div>

          <div style={panel} className="overflow-hidden rounded-[18px]">
            <div
              className="grid gap-3 border-b border-white/[0.06] bg-white/[0.04] px-[18px] py-[11px] text-[10px] font-bold tracking-[0.06em] text-[#7a7a8c]"
              style={{ gridTemplateColumns: "150px 1fr 130px 108px 26px" }}
            >
              <span>TIMESTAMP</span><span>EVENT</span><span>ACTOR</span><span>STATUS</span><span />
            </div>
            {rows.map((e) => {
              const cat = CAT[e.category] ?? ["Other", "#c3c3d0", "rgba(255,255,255,.08)"];
              const st = STATUS[e.status] ?? STATUS.success;
              const [ac, acBg] = ACTOR[e.actorType] ?? ACTOR.system;
              const isAi = e.actorType === "ai";
              const [day, timePart] = e.ts.includes("T") ? e.ts.split("T") : e.ts.split(" ");
              const time = (timePart || "").slice(0, 5);
              const open = expanded === e.id;
              return (
                <div key={e.id} className="border-b border-white/[0.045]">
                  <div
                    onClick={() => setExpanded(open ? null : e.id)}
                    className="grid cursor-pointer items-center gap-3 px-[18px] py-[13px] hover:bg-white/[0.03]"
                    style={{ gridTemplateColumns: "150px 1fr 130px 108px 26px" }}
                  >
                    <div>
                      <div className="font-mono text-[12.5px] font-semibold text-[#c7c7d4]">{time}</div>
                      <div className="font-mono text-[10.5px] text-[#7a7a8c]">{day}</div>
                    </div>
                    <div className="min-w-0">
                      <div className="mb-0.5 flex items-center gap-2">
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
                          style={{ background: cat[2], color: cat[1] }}
                        >
                          {cat[0]}
                        </span>
                        <span className="truncate text-[13.5px] font-semibold">{e.action}</span>
                      </div>
                      <div className="truncate text-[12px] text-[#8b8b9e]">{e.target}</div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px] text-[9.5px] font-bold"
                        style={{ background: acBg, color: isAi ? "#fff" : ac }}
                      >
                        {isAi ? (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
                          </svg>
                        ) : (
                          initials(e.actor)
                        )}
                      </span>
                      <span className="truncate text-[12.5px] font-semibold">{e.actor}</span>
                    </div>
                    <div>
                      <span
                        className="rounded-full px-2.5 py-[3px] text-[11px] font-bold"
                        style={{ background: st[1], color: st[0] }}
                      >
                        {st[2]}
                      </span>
                    </div>
                    <ChevronRight
                      size={15}
                      className="shrink-0 text-[#8b8b9e] transition-transform"
                      style={open ? { transform: "rotate(90deg)" } : undefined}
                    />
                  </div>
                  {open && (
                    <div className="animate-fade-in-up px-[18px] pb-4 pt-0.5">
                      <div
                        className="grid gap-x-[22px] gap-y-2.5 rounded-xl border border-white/[0.06] bg-white/[0.03] px-4 py-3.5"
                        style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}
                      >
                        <Field label="EVENT ID" value={e.id} mono color="#67e8f9" />
                        <Field label="TIMESTAMP" value={e.ts.replace("T", " ").slice(0, 19)} mono />
                        <Field label="TARGET" value={e.target} />
                        <Field label="IP ADDRESS" value={e.ip} mono />
                        <div className="col-span-full">
                          <div className="mb-[3px] text-[10.5px] text-[#7a7a8c]">DETAILS</div>
                          <div className="text-[12.5px] leading-relaxed text-[#c3c3d0]">{e.meta}</div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {rows.length === 0 && (
              <div className="flex flex-col items-center px-8 py-12 text-center">
                <div className="mb-1 text-[14px] font-semibold">No events match your filters</div>
                <div className="text-[12.5px] text-[#8b8b9e]">Try a different category, actor, or search term.</div>
              </div>
            )}
          </div>
          {rows.length > 0 && (
            <div className="mt-3.5 text-center text-[12px] text-[#7a7a8c]">Showing {rows.length} events</div>
          )}
        </>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3.5">
            <StatCard label="Log volume · 24h" value={(logStats?.logVolume ?? 0).toLocaleString()} color="#67e8f9" />
            <StatCard
              label="Services healthy"
              value={`${logStats?.servicesHealthy ?? 0} / ${logStats?.servicesTotal ?? 0}`}
              color="#6ee7b7"
            />
            <StatCard label="Warnings · 1h" value={String(logStats?.warnings ?? 0)} color="#fbbf24" />
            <StatCard label="Errors · 1h" value={String(logStats?.errors ?? 0)} color="#fb7185" />
          </div>

          <div style={panel} className="mb-3.5 flex flex-wrap items-center gap-2.5 rounded-2xl px-3.5 py-3">
            <div className="flex h-9 min-w-[200px] max-w-[300px] flex-1 items-center gap-2 rounded-[11px] border border-white/[0.08] bg-white/[0.04] px-3">
              <Search size={14} className="text-[#7a7a8c]" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search message, service, trace…"
                className="flex-1 bg-transparent text-[13px] text-ink outline-none"
              />
            </div>
            <div className="flex flex-wrap gap-[7px]">
              {LEVEL_CHIPS.map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setLevel(id)}
                  className="rounded-[10px] px-[13px] py-[7px] text-[12.5px] font-semibold"
                  style={chipStyle(level === id, "violet")}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              onClick={() => setLiveTail((v) => !v)}
              className="flex items-center gap-2 rounded-[10px] px-[13px] py-[7px] text-[12.5px] font-semibold"
              style={
                liveTail
                  ? { background: "rgba(16,185,129,.16)", color: "#6ee7b7", boxShadow: "inset 0 0 0 1px rgba(16,185,129,.3)" }
                  : { background: "rgba(255,255,255,.05)", color: "#a0a0b2" }
              }
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: liveTail ? "#10b981" : "#6b7280", animation: liveTail ? "pulseDot 1.4s infinite" : undefined }}
              />
              {liveTail ? "Live tail on" : "Live tail"}
            </button>
          </div>

          <div className="mb-4 flex flex-wrap gap-[7px]">
            {[["all", "All services"], ...services.map((s) => [s, s] as [string, string])].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setService(id)}
                className="whitespace-nowrap rounded-[9px] px-3 py-1.5 font-mono text-[11.5px] font-semibold"
                style={chipStyle(service === id, "cyan")}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            className="overflow-hidden rounded-[18px] border border-white/[0.08]"
            style={{ background: "rgba(8,8,13,.72)", backdropFilter: "blur(22px)", WebkitBackdropFilter: "blur(22px)" }}
          >
            <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-[11px]">
              <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#f43f5e" }} />
              <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#fbbf24" }} />
              <span className="h-[11px] w-[11px] rounded-full" style={{ background: "#10b981" }} />
              <span className="ml-2 font-mono text-[12px] text-[#8b8b9e]">q-agent · kubectl logs -f --all-services</span>
              <span className="ml-auto font-mono text-[11px] text-[#7a7a8c]">{logRows.length} lines</span>
            </div>
            <div className="max-h-[520px] overflow-y-auto font-mono text-[12px]">
              {logRows.map((l, i) => {
                const lv = LEVEL[l.level] ?? LEVEL.info;
                const msColor =
                  l.durationMs == null ? "#6c6c7e" : l.durationMs > 1500 ? "#fb7185" : l.durationMs > 500 ? "#fbbf24" : "#8b8b9e";
                return (
                  <div
                    key={`${l.trace}-${i}`}
                    className="grid animate-fade-in-up items-baseline gap-3 border-b border-white/[0.035] px-4 py-2 leading-normal hover:bg-white/[0.03]"
                    style={{ gridTemplateColumns: "104px 62px 128px 1fr 62px" }}
                  >
                    <span className="text-[#6c6c7e]">{l.ts}</span>
                    <span
                      className="rounded-md py-0.5 text-center text-[10px] font-bold tracking-[0.04em]"
                      style={{ color: lv[1], background: lv[2] }}
                    >
                      {lv[0]}
                    </span>
                    <span className="text-[#93c5fd]">{l.service}</span>
                    <span className="truncate text-[#c7c7d4]">{l.message}</span>
                    <span className="text-right" style={{ color: msColor }}>
                      {l.durationMs == null ? "—" : `${l.durationMs}ms`}
                    </span>
                  </div>
                );
              })}
              {logRows.length === 0 && (
                <div className="flex flex-col items-center px-8 py-12 text-center" style={{ fontFamily: "var(--font-sans, sans-serif)" }}>
                  <div className="mb-1 text-[14px] font-semibold">No log lines match your filters</div>
                  <div className="text-[12.5px] text-[#8b8b9e]">Try a different level, service, or search term.</div>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Field({ label, value, mono, color }: { label: string; value: string; mono?: boolean; color?: string }) {
  return (
    <div>
      <div className="mb-[3px] text-[10.5px] text-[#7a7a8c]">{label}</div>
      <div className={`text-[12.5px] ${mono ? "font-mono" : ""}`} style={{ color: color ?? "#dcdce4" }}>
        {value}
      </div>
    </div>
  );
}
