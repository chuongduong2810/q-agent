import { useEffect, useMemo } from "react";
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
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/misc";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { api } from "@/lib/api";
import { cn } from "@/lib/cn";
import { useAnnotate, useEvidence } from "@/hooks/queries";
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

export function Evidence() {
  const activeRunId = useUI((s) => s.activeRunId);
  const navigate = useUI((s) => s.navigate);
  const evidenceTicket = useUI((s) => s.evidenceTicket);
  const setEvidenceTicket = useUI((s) => s.setEvidenceTicket);
  const evidenceTab = useUI((s) => s.evidenceTab);
  const setEvidenceTab = useUI((s) => s.setEvidenceTab);
  const tool = useUI((s) => s.tool);
  const setTool = useUI((s) => s.setTool);

  const { data: evidence, isLoading, isError } = useEvidence(activeRunId);
  const annotate = useAnnotate(activeRunId ?? 0);

  const tickets = evidence?.tickets ?? [];

  // Default to the first ticket once evidence loads.
  useEffect(() => {
    if (!evidenceTicket && tickets.length) setEvidenceTicket(tickets[0].id);
  }, [tickets, evidenceTicket, setEvidenceTicket]);

  const selectedTicket = tickets.find((t) => t.id === evidenceTicket) ?? tickets[0];
  const results = (evidenceTicket && evidence?.byTicket[evidenceTicket]) || [];

  const notReady = isError || isLoading === false ? !tickets.length : false;

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-3.5">
        <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
          RUN-{activeRunId ?? "…"} &middot; artifacts grouped by ticket
        </div>
        <h1 className="m-0 text-[28px] font-black tracking-tight">Evidence</h1>
      </div>

      <div className="mb-4">
        <PipelineRail stage={8} />
      </div>

      {isLoading ? (
        <div className="grid grid-cols-[300px_1fr] gap-3.5">
          <div className="glass h-64 animate-pulse rounded-[18px]" />
          <div className="glass h-96 animate-pulse rounded-[18px]" />
        </div>
      ) : notReady ? (
        <EmptyState
          icon={<Rows3 size={30} color="#7a7a8c" strokeWidth={1.8} />}
          title="No evidence yet"
          body="Run the approved suite to capture evidence for every ticket in the Run."
          action={
            <Button variant="primary" size="lg" onClick={() => navigate("console")}>
              Go to execution
            </Button>
          }
        />
      ) : (
        <div className="grid grid-cols-[300px_1fr] items-start gap-3.5">
          <div className="flex flex-col gap-3">
            <div className="glass rounded-[18px] p-3.5">
              <div className="m-[2px_4px_10px] text-[11px] font-semibold tracking-[.08em] text-[#6c6c7e]">
                TICKETS IN RUN
              </div>
              <div className="flex flex-col gap-2">
                {tickets.map((t) => {
                  const active = t.id === evidenceTicket;
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
                        <div
                          className="text-[11px] font-semibold"
                          style={{ color: t.fail > 0 ? "#fb7185" : "#6ee7b7" }}
                        >
                          {t.statusLabel}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <Button variant="primary" size="lg" onClick={() => navigate("comment")} className="w-full">
              Prepare ticket comments
              <ArrowRight size={15} strokeWidth={2.2} />
            </Button>
          </div>

          <div className="glass overflow-hidden rounded-[18px]">
            <div className="flex items-center gap-2.5 border-b border-white/[0.06] p-[14px_18px]">
              <span className="font-mono text-[12px] font-semibold text-violet">{selectedTicket?.id ?? "—"}</span>
              <span className="flex-1 text-[13px] font-semibold">Run evidence</span>
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
              <EvidencePanel
                tab={evidenceTab}
                ticketId={selectedTicket?.id ?? ""}
                results={results}
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
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EvidencePanel({
  tab,
  ticketId,
  results,
  tool,
  setTool,
  onAnnotate,
}: {
  tab: EvidenceTab;
  ticketId: string;
  results: ExecutionResultOut[];
  tool: AnnotationTool;
  setTool: (t: AnnotationTool) => void;
  onAnnotate: (evidenceId: number, shapes: { tool: string; x: number; y: number }[]) => void;
}) {
  const failed = results.find((r) => r.status === "fail");
  const screenshot = (failed ?? results[0])?.evidence.find((e) => e.kind === "screenshot");

  const consoleLogs = useMemo(
    () => results.flatMap((r) => r.consoleLogs) as Array<Record<string, unknown>>,
    [results],
  );
  const networkLogs = useMemo(
    () => results.flatMap((r) => r.networkLogs) as Array<Record<string, unknown>>,
    [results],
  );

  if (tab === "screenshot") {
    if (!failed || !screenshot) {
      return (
        <div className="overflow-hidden rounded-[14px] border border-white/10">
          <BrowserChrome label={`${ticketId} · all steps passed`} />
          <div className="flex items-center gap-3.5 bg-[#f6f7fb] p-[22px] text-[#1e2430]">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#10b981]">
              <CheckCircle2 size={22} color="#fff" strokeWidth={3} />
            </div>
            <div>
              <div className="text-[15px] font-extrabold text-[#111827]">All assertions passed</div>
              <div className="mt-[3px] text-[12.5px] text-[#5b616e]">
                Full-page screenshots captured for each step — no defects.
              </div>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div>
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
            <BrowserChrome label={`${failed.ticketExternalId} · ${failed.caseCode} · ${failed.title}`} />
            <img src={api.artifactUrl(screenshot.path)} alt={screenshot.filename} className="block w-full" />
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
    const video = results.flatMap((r) => r.evidence).find((e) => e.kind === "video");
    return (
      <div className="flex aspect-video flex-col items-center justify-center gap-3.5 rounded-[14px] border border-white/10 bg-gradient-to-br from-[#12121a] to-[#1b1b28]">
        <div className="flex h-16 w-16 cursor-pointer items-center justify-center rounded-full bg-[rgba(139,92,246,.2)] transition-colors hover:bg-[rgba(139,92,246,.3)]">
          <Play size={26} fill="#c4b5fd" stroke="none" />
        </div>
        <div className="font-mono text-[13px] text-[#9494a6]">
          {video ? `${video.filename} · ${(video.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${ticketId}-run.webm`}
        </div>
      </div>
    );
  }

  if (tab === "trace") {
    return (
      <div className="overflow-hidden rounded-[14px] border border-white/10">
        <div className="flex items-center gap-[7px] bg-white/[0.04] p-[11px_14px] font-mono text-[12px] text-[#c7c7d4]">
          trace.zip · Playwright Trace Viewer
        </div>
        <div className="flex flex-col gap-[7px] p-4 font-mono text-[12px]">
          {results.length ? (
            results.map((r) => (
              <div key={r.id} className="flex gap-3 text-ink-dim">
                <span className="text-[#6ee7b7]">{(r.durationMs / 1000).toFixed(1)}s</span> {r.caseCode} — {r.title}
              </div>
            ))
          ) : (
            <div className="text-ink-dim">No trace steps recorded.</div>
          )}
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
          <div className="text-ink-dim">No console output captured.</div>
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
        <div className="p-4 text-center text-[12.5px] text-ink-dim">No network requests captured.</div>
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
