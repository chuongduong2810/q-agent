import { useState } from "react";
import { motion } from "framer-motion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Brain,
  Check,
  Clock,
  Cpu,
  FileText,
  Image as ImageIcon,
  Send,
  Terminal,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/misc";
import { providerGlyph } from "@/components/ui/badges";
import { PipelineRail, runStatusToStage } from "@/components/ui/PipelineRail";
import { useNavigate, useParams } from "react-router-dom";
import { useRun, useRunAiUsage, useTickets } from "@/hooks/queries";
import { useRunEvents } from "@/hooks/useRunEvents";
import type { ProgressEvent, RunAiUsage, RunTicketOut } from "@/types/api";

const RUN_STATUS_LABEL: Record<string, string> = {
  processing: "AI processing",
  review: "Ready for review",
  sync: "Creating & linking",
  automation: "Automation",
  executing: "Executing",
  evidence: "Evidence ready",
  comment: "Publishing",
  done: "Complete",
};

/** Run detail: pipeline stage, live processing banner, and per-ticket generation status. */
export function RunDetail() {
  const runId = Number(useParams().runId);
  const navigate = useNavigate();

  const { data: run, isLoading } = useRun(runId);
  const { data: tickets } = useTickets();
  const { data: aiUsage } = useRunAiUsage(runId);

  // Live phase messages per ticket, keyed by ticket externalId — updated from the
  // analysis.phase WS event since RunTicketOut.genStatus alone has no message text.
  const [phaseMsgs, setPhaseMsgs] = useState<Record<string, string>>({});
  useRunEvents((evt: ProgressEvent) => {
    if (evt.event === "analysis.phase") {
      const { ticket, message } = evt.payload as { ticket?: string; message?: string };
      if (ticket && message) setPhaseMsgs((m) => ({ ...m, [ticket]: message }));
    }
  });

  if (isLoading || !run) {
    return (
      <div className="px-1 pb-10 pt-0.5">
        <div className="glass mb-4 h-8 w-24 animate-pulse rounded-lg" />
        <div className="glass mb-4 h-[76px] animate-pulse rounded-[18px]" />
        <div className="flex flex-col gap-[11px]">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="glass h-[66px] animate-pulse rounded-2xl" />
          ))}
        </div>
      </div>
    );
  }

  const processing = run.status === "processing";
  const goReview = () => {
    navigate("/runs/" + run.id + "/review");
  };

  const total = run.runTickets.length;
  const analyzed = run.runTickets.filter((rt) => rt.genStatus === "done").length;
  const pct = total ? Math.round((analyzed / total) * 100) : 0;
  const headline = Object.values(phaseMsgs).at(-1) ?? "Reading requirements…";

  return (
    <div className="px-1 pb-10 pt-0.5">
      <button
        onClick={() => navigate("/runs")}
        className="mb-3.5 flex cursor-pointer items-center gap-[7px] border-none bg-transparent p-0 text-[12.5px] font-semibold text-ink-dim hover:text-[#c7c7d4]"
      >
        <ArrowLeft size={14} strokeWidth={2.2} />
        All runs
      </button>

      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <div className="mb-1.5 flex items-center gap-2.5">
            <span className="font-mono text-[13px] font-semibold text-violet">{run.code}</span>
            <span
              className="rounded-full px-2.5 py-[3px] text-[11px] font-bold text-[#fbbf24]"
              style={{ background: "rgba(245,158,11,.14)" }}
            >
              {RUN_STATUS_LABEL[run.status] ?? run.status}
            </span>
          </div>
          <h1 className="m-0 text-[26px] font-black tracking-tight">{run.name}</h1>
          <div className="mt-1.5 text-[12.5px] text-ink-dim">
            {run.scopeLabel} &middot; {run.framework} &middot; {run.env} &middot; {run.workers} workers
          </div>
        </div>
        <Button variant="primary" onClick={goReview} className="shrink-0">
          Open Review Center
          <ArrowRight size={14} strokeWidth={2.2} />
        </Button>
      </div>

      <div className="mb-4">
        <PipelineRail stage={runStatusToStage[run.status] ?? 0} />
      </div>

      {processing && (
        <div
          className="relative mb-3.5 overflow-hidden rounded-[20px] p-[22px_24px]"
          style={{
            background: "linear-gradient(135deg,rgba(139,92,246,.2),rgba(99,102,241,.08))",
            border: "1px solid rgba(139,92,246,.34)",
            boxShadow: "0 0 40px -12px rgba(139,92,246,.4)",
          }}
        >
          <div
            className="pointer-events-none absolute bottom-0 left-0 top-0 w-[120px]"
            style={{
              background: "linear-gradient(90deg,transparent,rgba(167,139,250,.18),transparent)",
              animation: "procScan 2.2s ease-in-out infinite",
            }}
          />
          <div className="relative flex items-center gap-[15px]">
            <div
              className="relative flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[13px]"
              style={{
                background: "linear-gradient(135deg,#8b5cf6,#6366f1)",
                boxShadow: "0 8px 24px -6px rgba(139,92,246,.7)",
              }}
            >
              <span
                className="absolute rounded-[16px]"
                style={{
                  inset: "-5px",
                  border: "2px solid transparent",
                  borderTopColor: "#c4b5fd",
                  borderRightColor: "#c4b5fd",
                  animation: "spin 1s linear infinite",
                }}
              />
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#fff"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 3l1.9 5.3L19 10l-5.1 1.7L12 17l-1.9-5.3L5 10l5.1-1.7z" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-[10px]">
                <span className="text-[15px] font-extrabold tracking-[-.01em]">
                  Q&#8209;Agent is analyzing your tickets
                </span>
                <span className="inline-flex gap-[3px]">
                  <span
                    className="h-[5px] w-[5px] rounded-full bg-[#c4b5fd]"
                    style={{ animation: "procDot 1.2s ease-in-out infinite" }}
                  />
                  <span
                    className="h-[5px] w-[5px] rounded-full bg-[#c4b5fd]"
                    style={{ animation: "procDot 1.2s ease-in-out .2s infinite" }}
                  />
                  <span
                    className="h-[5px] w-[5px] rounded-full bg-[#c4b5fd]"
                    style={{ animation: "procDot 1.2s ease-in-out .4s infinite" }}
                  />
                </span>
              </div>
              <div className="mt-[3px] text-[12.5px] text-[#c3b8e8]">{headline}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[22px] font-black tracking-[-.02em] text-white">
                {analyzed}
                <span className="text-[13px] font-bold text-[#b9a8e6]">/{total}</span>
              </div>
              <div className="text-[10.5px] font-semibold tracking-[.03em] text-[#b9a8e6]">
                TICKETS ANALYZED
              </div>
            </div>
          </div>
          <div
            className="relative mt-[16px] h-[6px] overflow-hidden rounded-[6px]"
            style={{ background: "rgba(255,255,255,.09)" }}
          >
            <div
              className="h-full rounded-[6px]"
              style={{
                background: "linear-gradient(90deg,#8b5cf6,#22d3ee)",
                width: pct + "%",
                transition: "width .5s cubic-bezier(.2,.8,.2,1)",
                boxShadow: "0 0 12px rgba(139,92,246,.7)",
              }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-[11px]">
        {run.runTickets.map((rt, i) => (
          <RunTicketRow
            key={rt.ticketExternalId}
            runTicket={rt}
            title={tickets?.find((t) => t.externalId === rt.ticketExternalId)?.title ?? rt.ticketExternalId}
            providerKind={tickets?.find((t) => t.externalId === rt.ticketExternalId)?.providerKind ?? "ado"}
            phaseMsg={phaseMsgs[rt.ticketExternalId]}
            index={i}
            onReview={() =>
              navigate("/runs/" + runId + "/review?ticket=" + encodeURIComponent(rt.ticketExternalId))
            }
          />
        ))}
      </div>

      {aiUsage && aiUsage.processes.length > 0 && (
        <AiUsageCard usage={aiUsage} runCode={run.code} />
      )}
    </div>
  );
}

function RunTicketRow({
  runTicket,
  title,
  providerKind,
  phaseMsg,
  index,
  onReview,
}: {
  runTicket: RunTicketOut;
  title: string;
  providerKind: string;
  phaseMsg?: string;
  index: number;
  onReview: () => void;
}) {
  const [glyph, color] = providerGlyph[providerKind] ?? ["?", "#8b8b9e"];
  const done = runTicket.genStatus === "done";
  const analyzing = runTicket.genStatus === "analyzing";
  const generating = runTicket.genStatus === "generating";
  const current = analyzing || generating;
  const queued = runTicket.genStatus === "queued";
  const errored = runTicket.genStatus === "error";
  // Prefer the live phase message; else a status-specific default per the design.
  const statusText = phaseMsg ?? (generating ? "Generating test cases…" : "Reading ticket…");

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
      className="glass flex items-center gap-[14px] rounded-2xl p-[16px_18px]"
    >
      {/* Provider avatar; a violet ring spins around it while this ticket is being processed. */}
      <div className="relative h-[34px] w-[34px] shrink-0">
        {current && (
          <span
            className="absolute rounded-[13px]"
            style={{
              inset: "-3px",
              border: "2px solid transparent",
              borderTopColor: "#c4b5fd",
              borderRightColor: "#c4b5fd",
              animation: "spin 1s linear infinite",
            }}
          />
        )}
        <div
          className="flex h-full w-full items-center justify-center rounded-[10px] text-[14px] font-black text-white"
          style={{ background: color }}
        >
          {glyph}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-[9px]">
          <span className="font-mono text-[11.5px] font-semibold text-violet">{runTicket.ticketExternalId}</span>
        </div>
        <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[14px] font-semibold">{title}</div>
      </div>

      {current && (
        <div className="flex items-center gap-[9px] text-[12.5px] font-semibold text-[#c4b5fd]">
          <Spinner size={15} />
          {statusText}
        </div>
      )}
      {done && (
        <Button variant="success" size="sm" onClick={onReview}>
          <Check size={13} strokeWidth={2.6} />
          Review
        </Button>
      )}
      {queued && (
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[#6b7280]">
          <Clock size={13} strokeWidth={2} />
          Queued
        </span>
      )}
      {errored && <span className="text-[12px] font-semibold text-[#fb7185]">Analysis failed</span>}
    </motion.div>
  );
}

/** USD → "$42.60". */
function fmtCost(usd: number): string {
  return `$${usd.toFixed(2)}`;
}

/** Compact token/number → "1.5K" / "2.4M" (integers below 1000 stay as-is). */
function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/** Lucide icon per AI-process key (falls back to Cpu for unknown kinds). */
const PROCESS_ICON: Record<string, LucideIcon> = {
  analyze: Brain,
  generate: FileText,
  automation: Terminal,
  analysis: Activity,
  publish: Send,
  evidence: ImageIcon,
};

/**
 * AI usage & cost card — per-process token spend for a run, read from
 * `GET /runs/{id}/ai-usage`. Rendered at the bottom of the run overview only when
 * there is at least one process with usage.
 */
function AiUsageCard({ usage, runCode }: { usage: RunAiUsage; runCode: string }) {
  return (
    <div className="glass mt-[18px] overflow-hidden rounded-[18px]">
      {/* Header */}
      <div
        className="flex items-center gap-[11px] p-[15px_18px]"
        style={{ borderBottom: "1px solid rgba(255,255,255,.06)" }}
      >
        <div
          className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px]"
          style={{ background: "rgba(217,119,87,.16)", border: "1px solid rgba(217,119,87,.3)" }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="#D97757">
            <path d="M12 2.4l2.6 6.6 6.9.4-5.3 4.4 1.8 6.7L12 17.3 6 20.9l1.8-6.7L2.5 9.4l6.9-.4z" />
          </svg>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-bold">AI usage &amp; cost</div>
          <div className="text-[11.5px] text-[#8b8b9e]">
            Per-process spend for {runCode} &middot; {usage.modelLabel}
          </div>
        </div>
        <div className="text-right">
          <div className="font-mono text-[18px] font-black tracking-[-.02em] text-[#6ee7b7]">
            {fmtCost(usage.totalCostUsd)}
          </div>
          <div className="text-[10.5px] text-[#8b8b9e]">{fmtCompact(usage.totalTokens)} tokens</div>
        </div>
      </div>

      {/* Column headers */}
      <div
        className="grid items-center gap-[10px] p-[9px_18px] text-[10px] font-bold tracking-[.05em] text-[#6c6c7e]"
        style={{ gridTemplateColumns: "1.5fr .8fr .8fr .8fr .7fr", background: "rgba(255,255,255,.02)" }}
      >
        <span>AI PROCESS</span>
        <span className="text-right">INPUT</span>
        <span className="text-right">OUTPUT</span>
        <span className="text-right">TOKENS</span>
        <span className="text-right">COST</span>
      </div>

      {/* Rows */}
      {usage.processes.map((p) => {
        const Icon = PROCESS_ICON[p.key] ?? Cpu;
        return (
          <div
            key={p.key}
            className="grid items-center gap-[10px] p-[12px_18px]"
            style={{
              gridTemplateColumns: "1.5fr .8fr .8fr .8fr .7fr",
              borderTop: "1px solid rgba(255,255,255,.045)",
            }}
          >
            <div className="flex min-w-0 items-center gap-[10px]">
              <span
                className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px]"
                style={{ background: "rgba(139,92,246,.14)" }}
              >
                <Icon size={14} strokeWidth={2} color="#a78bfa" />
              </span>
              <div className="min-w-0">
                <div className="overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px] font-semibold">
                  {p.name}
                </div>
                <div className="text-[10.5px] text-[#7a7a8c]">{p.meta}</div>
              </div>
            </div>
            <span className="text-right font-mono text-[12px] text-[#9a9aae]">{fmtCompact(p.input)}</span>
            <span className="text-right font-mono text-[12px] text-[#9a9aae]">{fmtCompact(p.output)}</span>
            <span className="text-right font-mono text-[12px] font-semibold text-[#c7c7d4]">
              {fmtCompact(p.tokens)}
            </span>
            <span className="text-right font-mono text-[12.5px] font-bold text-[#6ee7b7]">
              {fmtCost(p.costUsd)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
