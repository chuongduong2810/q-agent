import { useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Spinner } from "@/components/ui/misc";
import { providerGlyph } from "@/components/ui/badges";
import { PipelineRail, runStatusToStage } from "@/components/ui/PipelineRail";
import { useNavigate, useParams } from "react-router-dom";
import { useRun, useTickets } from "@/hooks/queries";
import { useRunEvents } from "@/hooks/useRunEvents";
import type { ProgressEvent, RunTicketOut } from "@/types/api";

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
      <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
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

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
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
          className="glass mb-3.5 rounded-[20px] p-[20px_22px]"
          style={{ borderColor: "rgba(139,92,246,.24)" }}
        >
          <div className="mb-1 flex items-center gap-[11px] text-[14px] font-bold">
            <span className="h-[5px] w-[5px] rounded-full bg-[#a78bfa]" style={{ animation: "think 1.4s infinite" }} />
            Q&#8209;Agent is processing the ticket queue
          </div>
          <div className="text-[12.5px] text-ink-dim">
            Reading requirements and generating test cases for each ticket in the Run
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
  const current = runTicket.genStatus === "analyzing" || runTicket.genStatus === "generating";
  const queued = runTicket.genStatus === "queued";

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.04, 0.3), ease: "easeOut" }}
      className="glass flex items-center gap-[14px] rounded-2xl p-[16px_18px]"
    >
      <div
        className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[14px] font-black text-white"
        style={{ background: color }}
      >
        {glyph}
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
          {phaseMsg ?? "Generating test cases…"}
        </div>
      )}
      {done && (
        <Button variant="success" size="sm" onClick={onReview}>
          <Check size={13} strokeWidth={2.6} />
          Review
        </Button>
      )}
      {queued && <span className="text-[12px] font-semibold text-[#6b7280]">Queued</span>}
    </motion.div>
  );
}
