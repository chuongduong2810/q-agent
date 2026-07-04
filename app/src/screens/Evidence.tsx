import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Circle,
  Highlighter,
  MousePointer2,
  Square,
  Type as TypeIcon,
  CheckCircle2,
  Play,
  Rows3,
  Sparkles,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/misc";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAnnotate, useAutoAnnotate, useEvidence } from "@/hooks/queries";
import { useUI, type AnnotationTool, type EvidenceTab } from "@/store/ui";
import type { ExecutionResultOut } from "@/types/api";

const TABS: { id: EvidenceTab; label: string }[] = [
  { id: "screenshot", label: "Screenshot" },
  { id: "video", label: "Video" },
  { id: "trace", label: "Trace" },
  { id: "console", label: "Console" },
  { id: "network", label: "Network" },
];

const TOOLS: { id: AnnotationTool; icon: typeof MousePointer2 }[] = [
  { id: "cursor", icon: MousePointer2 },
  { id: "rectangle", icon: Square },
  { id: "arrow", icon: ArrowRight },
  { id: "highlight", icon: Highlighter },
  { id: "circle", icon: Circle },
  { id: "text", icon: TypeIcon },
];

const STATUS_COLOR: Record<string, string> = {
  pass: "#6ee7b7",
  fail: "#fb7185",
  running: "#fbbf24",
  pending: "#9494a6",
  skipped: "#9494a6",
};

export function Evidence() {
  const runId = Number(useParams().runId);
  const navigate = useNavigate();
  const evidenceTab = useUI((s) => s.evidenceTab);
  const setEvidenceTab = useUI((s) => s.setEvidenceTab);
  const tool = useUI((s) => s.tool);
  const setTool = useUI((s) => s.setTool);

  // Which ticket's evidence is shown — a deep-linkable selection in the URL.
  const [searchParams, setSearchParams] = useSearchParams();
  const evidenceTicket = searchParams.get("ticket");
  const setEvidenceTicket = useCallback(
    (tid: string, replace = false) =>
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("ticket", tid);
          return next;
        },
        { replace },
      ),
    [setSearchParams],
  );

  const { data: evidence, isLoading, isError } = useEvidence(runId);
  const annotate = useAnnotate(runId);
  const autoAnnotate = useAutoAnnotate(runId);

  const tickets = evidence?.tickets ?? [];

  // Default to the first ticket once evidence loads.
  useEffect(() => {
    if (!evidenceTicket && tickets.length) setEvidenceTicket(tickets[0].id, true);
  }, [tickets, evidenceTicket, setEvidenceTicket]);

  const selectedTicket = tickets.find((t) => t.id === evidenceTicket) ?? tickets[0];
  const results = (evidenceTicket && evidence?.byTicket[evidenceTicket]) || [];

  // Which test case's evidence is shown. Default to the first failed case (or the
  // first case) whenever the ticket changes or the selection falls out of the set.
  const [selectedResultId, setSelectedResultId] = useState<number | null>(null);
  useEffect(() => {
    if (!results.length) {
      if (selectedResultId !== null) setSelectedResultId(null);
      return;
    }
    if (!results.some((r) => r.id === selectedResultId)) {
      setSelectedResultId((results.find((r) => r.status === "fail") ?? results[0]).id);
    }
  }, [results, selectedResultId]);
  const selectedResult = results.find((r) => r.id === selectedResultId) ?? results[0];

  const notReady = isError || isLoading === false ? !tickets.length : false;

  return (
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-3.5">
        <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
          RUN-{runId} &middot; evidence per test case, grouped by ticket
        </div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Evidence</h1>
      </div>

      <div className="mb-4">
        <PipelineRail stage={8} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[240px_1fr] gap-3.5">
          <div className="glass h-64 animate-pulse rounded-[18px]" />
          <div className="glass h-96 animate-pulse rounded-[18px]" />
        </div>
      ) : notReady ? (
        <EmptyState
          icon={<Rows3 size={30} color="#7a7a8c" strokeWidth={1.8} />}
          title="No evidence yet"
          body="Run the approved suite to capture evidence for every ticket in the Run."
          action={
            <Button variant="primary" size="lg" onClick={() => navigate("/runs/" + runId + "/execution")}>
              Go to execution
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[240px_1fr] items-start gap-3.5">
          {/* Tickets — status is the aggregate of all the ticket's cases. */}
          <div className="flex flex-col gap-3">
            <div className="glass rounded-[18px] p-3.5">
              <div className="m-[2px_4px_10px] text-[11px] font-semibold tracking-[.08em] text-[#6c6c7e]">
                TICKETS IN RUN
              </div>
              <div className="flex flex-col gap-2">
                {tickets.map((t) => {
                  const active = t.id === evidenceTicket;
                  // Denominator is the approved-case count: a ticket is "Passed"
                  // only when every approved case's script ran and passed.
                  const total = t.approved || t.pass + t.fail;
                  const statusColor =
                    t.statusLabel === "Passed" ? "#6ee7b7" : t.statusLabel === "Failed" ? "#fb7185" : "#fbbf24";
                  return (
                    <div
                      key={t.id}
                      onClick={() => setEvidenceTicket(t.id)}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl p-2 transition-colors",
                        active ? "bg-white/[0.08]" : "hover:bg-white/[0.04]",
                      )}
                    >
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] text-[12px] font-black text-white"
                        style={{ background: t.provColor }}
                      >
                        {t.provGlyph}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="font-mono text-[11.5px] font-semibold text-violet">{t.id}</div>
                        <div className="text-[11px] font-semibold" style={{ color: statusColor }}>
                          {t.statusLabel}
                          <span className="ml-1 font-normal text-ink-dim">
                            · {t.pass}/{total} passed
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Button variant="primary" size="lg" onClick={() => navigate("/runs/" + runId + "/comment")} className="w-full">
              Prepare ticket comments
              <ArrowRight size={15} strokeWidth={2.2} />
            </Button>
          </div>

          {/* Test cases for the selected ticket + the chosen case's evidence. */}
          <div className="grid grid-cols-[210px_1fr] items-start gap-3.5">
            <div className="glass rounded-[18px] p-3">
              <div className="m-[2px_4px_6px] text-[11px] font-semibold tracking-[.08em] text-[#6c6c7e]">
                TEST CASES · {selectedTicket?.id ?? "—"}
              </div>
              <div className="mb-2 px-1 text-[11px] text-ink-dim">
                {selectedTicket
                  ? `${selectedTicket.pass}/${selectedTicket.approved || selectedTicket.pass + selectedTicket.fail} passed`
                  : ""}
              </div>
              <div className="flex flex-col gap-1.5">
                {results.map((r) => {
                  const active = r.id === selectedResult?.id;
                  const color = STATUS_COLOR[r.status] ?? "#9494a6";
                  return (
                    <button
                      key={r.id}
                      onClick={() => setSelectedResultId(r.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 rounded-[11px] border p-2.5 text-left transition-colors",
                        active
                          ? "border-violet/40 bg-white/[0.07]"
                          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: color }} />
                        <span className="font-mono text-[11px] font-semibold text-ink-soft">{r.caseCode}</span>
                        <span className="ml-auto text-[10.5px] text-ink-dim">
                          {r.durationMs ? `${(r.durationMs / 1000).toFixed(1)}s` : "—"}
                        </span>
                      </div>
                      <div className="line-clamp-2 text-[12px] leading-snug text-ink-soft">{r.title}</div>
                      <span
                        className="w-fit rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
                        style={{ color, background: `${color}22` }}
                      >
                        {r.status}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="glass overflow-hidden rounded-[18px]">
              <div className="flex items-center gap-2.5 border-b border-white/[0.06] p-[14px_18px]">
                <span className="font-mono text-[12px] font-semibold text-violet">
                  {selectedResult?.caseCode ?? "—"}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">
                  {selectedResult?.title ?? "Select a test case"}
                </span>
                {selectedResult && (
                  <span
                    className="rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                    style={{
                      color: STATUS_COLOR[selectedResult.status] ?? "#9494a6",
                      background: `${STATUS_COLOR[selectedResult.status] ?? "#9494a6"}22`,
                    }}
                  >
                    {selectedResult.status}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-[7px] border-b border-white/[0.06] p-[12px_18px]">
                {TABS.map((t) => {
                  const active = evidenceTab === t.id;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setEvidenceTab(t.id)}
                      className="cursor-pointer rounded-[10px] px-3 py-[7px] text-[12.5px] font-semibold transition-colors"
                      style={
                        active
                          ? { background: "linear-gradient(135deg,#8b5cf6,#6366f1)", color: "#fff" }
                          : { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.09)", color: "#dcdce4" }
                      }
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
              <div className="p-[18px]">
                {selectedResult ? (
                  <EvidencePanel
                    tab={evidenceTab}
                    result={selectedResult}
                    tool={tool}
                    setTool={setTool}
                    onAnnotate={(evidenceId, shapes) =>
                      annotate.mutate(
                        { evidenceId, shapes },
                        {
                          onSuccess: () => toast.success("Annotation saved"),
                          onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to save annotation"),
                        },
                      )
                    }
                    onAutoAnnotate={(evidenceId) =>
                      autoAnnotate.mutate(evidenceId, {
                        onSuccess: () => toast.success("Screenshot analyzed & annotated"),
                        onError: (err) =>
                          toast.error(err instanceof Error ? err.message : "Auto-analysis failed"),
                      })
                    }
                    autoAnnotating={autoAnnotate.isPending}
                  />
                ) : (
                  <div className="text-[13px] text-ink-dim">No test cases in this ticket.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvidencePanel({
  tab,
  result,
  tool,
  setTool,
  onAnnotate,
  onAutoAnnotate,
  autoAnnotating,
}: {
  tab: EvidenceTab;
  result: ExecutionResultOut;
  tool: AnnotationTool;
  setTool: (t: AnnotationTool) => void;
  onAnnotate: (evidenceId: number, shapes: { tool: string; x: number; y: number }[]) => void;
  onAutoAnnotate: (evidenceId: number) => void;
  autoAnnotating: boolean;
}) {
  const [shotView, setShotView] = useState<"annotated" | "original">("annotated");
  const caseLabel = `${result.ticketExternalId} · ${result.caseCode} · ${result.title}`;
  const screenshot = result.evidence.find((e) => e.kind === "screenshot");

  const consoleLogs = useMemo(
    () => (result.consoleLogs ?? []) as Array<Record<string, unknown>>,
    [result],
  );
  const networkLogs = useMemo(
    () => (result.networkLogs ?? []) as Array<Record<string, unknown>>,
    [result],
  );

  if (tab === "screenshot") {
    if (!screenshot) {
      const passed = result.status === "pass";
      return (
        <div className="overflow-hidden rounded-[14px] border border-white/10">
          <BrowserChrome label={`${result.caseCode} · ${passed ? "passed — no defects" : "no screenshot captured"}`} />
          <div className="flex items-center gap-3.5 bg-[#f6f7fb] p-[22px] text-[#1e2430]">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
              style={{ background: passed ? "#10b981" : "#9aa0af" }}
            >
              {passed ? <CheckCircle2 size={22} color="#fff" strokeWidth={3} /> : <Rows3 size={20} color="#fff" />}
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-[#111827]">
                {passed ? "All assertions passed" : "No screenshot for this case"}
              </div>
              <div className="mt-[3px] text-[12.5px] text-[#5b616e]">
                {passed
                  ? "Screenshots are captured only on failure — nothing to annotate here."
                  : "This case has no failure screenshot to annotate."}
              </div>
            </div>
          </div>
        </div>
      );
    }
    const meta = (screenshot.meta ?? {}) as {
      diagnosis?: string;
      annotatedPath?: string;
      autoAnnotated?: boolean;
    };
    const hasAnnotated = !!meta.annotatedPath;
    const showAnnotated = hasAnnotated && shotView === "annotated";
    const imgSrc = api.artifactUrl(showAnnotated && meta.annotatedPath ? meta.annotatedPath : screenshot.path);

    return (
      <div>
        {meta.diagnosis && (
          <div className="mb-3.5 flex items-start gap-2.5 rounded-[12px] border border-[rgba(244,63,94,.28)] bg-[rgba(244,63,94,.1)] p-3">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#fb7185]" strokeWidth={2.2} />
            <div className="min-w-0">
              <div className="mb-0.5 text-[11px] font-bold uppercase tracking-[.06em] text-[#fb7185]">
                AI diagnosis
              </div>
              <div className="text-[13px] leading-relaxed text-[#f7c9cf]">{meta.diagnosis}</div>
            </div>
          </div>
        )}

        <div className="mb-2.5 flex items-center gap-2.5">
          {hasAnnotated && (
            <div className="flex overflow-hidden rounded-[9px] border border-white/[0.09]">
              {(["annotated", "original"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setShotView(v)}
                  className="px-3 py-1.5 text-[11.5px] font-semibold capitalize transition-colors"
                  style={
                    shotView === v
                      ? { background: "rgba(139,92,246,.22)", color: "#c4b5fd" }
                      : { background: "rgba(255,255,255,.04)", color: "#9494a6" }
                  }
                >
                  {v}
                </button>
              ))}
            </div>
          )}
          <Button
            variant="glass"
            size="sm"
            className="ml-auto"
            disabled={autoAnnotating}
            onClick={() => onAutoAnnotate(screenshot.id)}
          >
            {autoAnnotating ? (
              <span
                className="h-[13px] w-[13px] rounded-full border-2"
                style={{ borderColor: "rgba(167,139,250,.35)", borderTopColor: "#a78bfa", animation: "spin .8s linear infinite" }}
              />
            ) : (
              <Sparkles size={14} strokeWidth={2.2} />
            )}
            {autoAnnotating ? "Analyzing…" : meta.autoAnnotated ? "Re-analyze" : "Auto-analyze"}
          </Button>
        </div>

        <div className="flex items-start gap-3.5">
          <div className="flex shrink-0 flex-col gap-2">
            {TOOLS.map(({ id, icon: Icon }) => {
              const active = tool === id;
              return (
                <div
                  key={id}
                  onClick={() => setTool(id)}
                  className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-[10px] transition-colors"
                  style={
                    active
                      ? { background: "rgba(139,92,246,.22)", border: "1px solid rgba(139,92,246,.4)" }
                      : { background: "rgba(255,255,255,.05)", border: "1px solid rgba(255,255,255,.08)" }
                  }
                >
                  <Icon size={15} color={active ? "#c4b5fd" : "#9494a6"} strokeWidth={2} />
                </div>
              );
            })}
          </div>
          <div className="flex-1 overflow-hidden rounded-[14px] border border-white/10">
            <BrowserChrome label={`${caseLabel}${showAnnotated ? " · annotated" : ""}`} />
            <img src={imgSrc} alt={screenshot.filename} className="block w-full" />
          </div>
        </div>
        <div className="mt-3.5 flex items-center gap-2.5 text-[12.5px] text-ink-dim">
          <span className="font-semibold text-[#c4b5fd]">Tool:</span> {tool}
          <Button
            variant="glass"
            size="sm"
            className="ml-auto"
            onClick={() => onAnnotate(screenshot.id, [{ tool, x: 0.5, y: 0.5 }])}
          >
            Save annotation
          </Button>
        </div>
      </div>
    );
  }

  if (tab === "video") {
    const video = result.evidence.find((e) => e.kind === "video");
    if (!video) {
      return (
        <div className="flex aspect-video flex-col items-center justify-center gap-3.5 rounded-[14px] border border-white/10 bg-gradient-to-br from-[#12121a] to-[#1b1b28]">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-[rgba(139,92,246,.2)]">
            <Play size={26} fill="#c4b5fd" stroke="none" />
          </div>
          <div className="font-mono text-[13px] text-[#9494a6]">No video captured for {result.caseCode}.</div>
        </div>
      );
    }
    return (
      <div className="overflow-hidden rounded-[14px] border border-white/10">
        <BrowserChrome label={`${video.filename} · ${(video.sizeBytes / 1024 / 1024).toFixed(1)} MB`} />
        <video
          controls
          preload="metadata"
          src={api.artifactUrl(video.path)}
          className="block w-full max-w-full bg-black"
        />
      </div>
    );
  }

  if (tab === "trace") {
    const trace = result.evidence.find((e) => e.kind === "trace");
    return (
      <div className="overflow-hidden rounded-[14px] border border-white/10">
        <div className="flex items-center gap-[7px] bg-white/[0.04] p-[11px_14px] font-mono text-[12px] text-[#c7c7d4]">
          {trace ? `${trace.filename} · Playwright Trace Viewer` : "Playwright Trace Viewer"}
        </div>
        <div className="flex flex-col gap-[7px] p-4 font-mono text-[12px]">
          <div className="flex gap-3 text-ink-dim">
            <span className="text-[#6ee7b7]">{(result.durationMs / 1000).toFixed(1)}s</span>
            {result.caseCode} — {result.title}
          </div>
          {result.errorMessage && <div className="text-[#fb7185]">{result.errorMessage}</div>}
          {!trace && <div className="text-ink-dim">No trace file recorded for this case.</div>}
        </div>
      </div>
    );
  }

  if (tab === "console") {
    return (
      <div className="rounded-[14px] border border-white/[0.09] bg-[rgba(8,8,13,.7)] p-4 font-mono text-[12.5px] leading-loose">
        {consoleLogs.length ? (
          consoleLogs.map((c, i) => {
            const level = (c.level as string) ?? "log";
            const color = level === "error" ? "#fb7185" : level === "warn" ? "#fbbf24" : "#9494a6";
            return (
              <div key={i} style={{ color }}>
                {String(c.text ?? c.message ?? JSON.stringify(c))}
              </div>
            );
          })
        ) : (
          <div className="text-ink-dim">No console output captured for {result.caseCode}.</div>
        )}
      </div>
    );
  }

  // network
  return (
    <div className="overflow-hidden rounded-[14px] border border-white/10">
      <div className="grid grid-cols-[60px_1fr_70px_70px] gap-2 bg-white/[0.04] p-[10px_14px] text-[10.5px] font-bold tracking-[.05em] text-[#7a7a8c]">
        <span>METHOD</span>
        <span>URL</span>
        <span>STATUS</span>
        <span>TIME</span>
      </div>
      {networkLogs.length ? (
        networkLogs.map((n, i) => {
          const status = Number(n.status ?? 0);
          const statusColor = status >= 400 ? "#fb7185" : status >= 300 ? "#fbbf24" : "#6ee7b7";
          return (
            <div
              key={i}
              className="grid grid-cols-[60px_1fr_70px_70px] gap-2 border-t border-white/[0.05] p-[11px_14px] font-mono text-[12px]"
            >
              <span className="text-violet">{String(n.method ?? "")}</span>
              <span className="truncate text-[#c7c7d4]">{String(n.url ?? "")}</span>
              <span style={{ color: statusColor }}>{status || "—"}</span>
              <span className="text-ink-dim">{String(n.durationMs ?? n.ms ?? "—")}</span>
            </div>
          );
        })
      ) : (
        <div className="p-4 text-center text-[12.5px] text-ink-dim">No network requests captured for {result.caseCode}.</div>
      )}
    </div>
  );
}

function BrowserChrome({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-[9px] bg-[#1b1b24] p-[9px_13px]">
      <span className="h-[9px] w-[9px] rounded-full bg-[#f43f5e]" />
      <span className="h-[9px] w-[9px] rounded-full bg-[#fbbf24]" />
      <span className="h-[9px] w-[9px] rounded-full bg-[#10b981]" />
      <span className="ml-1.5 font-mono text-[11px] text-[#9494a6]">{label}</span>
    </div>
  );
}
