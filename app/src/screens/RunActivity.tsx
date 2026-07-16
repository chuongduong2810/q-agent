import { useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Radio, RefreshCw, ScrollText } from "lucide-react";
import { useRun, useRunActivity } from "@/hooks/queries";
import { timeAgo } from "@/components/dashboard/runStatus";
import { cn } from "@/lib/cn";
import type { AuditEventOut } from "@/types/api";

/**
 * Per-run activity timeline (#394). Reads the run's persisted audit events
 * (`GET /audit/events?run=RUN-XXX`) and renders them as a newest-first trail —
 * generation, automation, exploration results, execution, and failures — so a
 * run that "ran but nothing happened" shows what actually occurred (e.g. an
 * exploration that reached the app but discovered nothing, or a Claude 401).
 *
 * Unlike the ephemeral Claude-activity panel and the run WebSocket trail, these
 * events are durable and survive a page reload / server restart.
 */

/** Accent per audit category, mirroring the global Audit Log palette. */
const CATEGORY_COLOR: Record<string, string> = {
  ai: "#a78bfa",
  sync: "#67e8f9",
  review: "#6ee7b7",
  execution: "#fbbf24",
  auth: "#f9a8d4",
  knowledge: "#c4b5fd",
  integration: "#93c5fd",
  run: "#fca5a5",
  automation: "#f0abfc",
  comment: "#5eead4",
  settings: "#d4d4d8",
};

/** [text color, chip background] per event status. */
const STATUS_COLOR: Record<string, [string, string]> = {
  success: ["#6ee7b7", "rgba(16,185,129,.14)"],
  warning: ["#fbbf24", "rgba(251,191,36,.13)"],
  error: ["#fb7185", "rgba(244,63,94,.14)"],
};

function EventRow({
  event,
  expanded,
  onToggle,
  statusLabel,
  fieldLabels,
}: {
  event: AuditEventOut;
  expanded: boolean;
  onToggle: () => void;
  statusLabel: string;
  fieldLabels: { when: string; actor: string; category: string; details: string };
}) {
  const dot = CATEGORY_COLOR[event.category] ?? "#c3c3d0";
  const [stColor, stBg] = STATUS_COLOR[event.status] ?? STATUS_COLOR.success;

  return (
    <li className="relative pl-7">
      {/* rail dot */}
      <span
        className="absolute left-[7px] top-[15px] z-10 h-2.5 w-2.5 rounded-full"
        style={{ background: dot, boxShadow: `0 0 0 4px ${dot}22` }}
      />
      <button
        onClick={onToggle}
        className="flex w-full items-start gap-3 rounded-[11px] border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-left transition-colors hover:bg-white/[0.05]"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[13px] font-bold">{event.action}</span>
            <span
              className="rounded-full px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wide"
              style={{ color: stColor, background: stBg }}
            >
              {statusLabel}
            </span>
          </div>
          {event.target && (
            <div className="mt-0.5 truncate text-[11.5px] text-ink-dim">{event.target}</div>
          )}
          {expanded && (
            <div className="mt-2.5 grid grid-cols-1 gap-2 border-t border-white/[0.06] pt-2.5 text-[11px] sm:grid-cols-2">
              <Field label={fieldLabels.when} value={new Date(event.ts).toLocaleString()} />
              <Field label={fieldLabels.actor} value={`${event.actor} (${event.actorType})`} />
              <Field label={fieldLabels.category} value={event.category} />
              {event.meta && (
                <div className="sm:col-span-2">
                  <Field label={fieldLabels.details} value={event.meta} />
                </div>
              )}
            </div>
          )}
        </div>
        <span className="shrink-0 whitespace-nowrap pt-0.5 text-[10.5px] text-ink-dim">
          {timeAgo(event.ts)}
        </span>
      </button>
    </li>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold tracking-[0.1em] text-[#5c5c6e]">{label}</div>
      <div className="mt-0.5 break-words text-ink">{value}</div>
    </div>
  );
}

export function RunActivity() {
  const runId = Number(useParams().runId);
  const { t } = useTranslation("runActivity");
  const { data: run } = useRun(runId);
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: events, isLoading } = useRunActivity(run?.code, live);

  return (
    <div className="px-1 pb-10 pt-0.5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            {run?.code ?? `RUN-${runId}`}
            {events ? ` · ${t("count", { count: events.length })}` : ""}
          </div>
          <h1 className="m-0 flex items-center gap-2 text-[24px] font-black tracking-tight md:text-[28px]">
            <ScrollText size={24} strokeWidth={2.2} className="text-[#c4b5fd]" />
            {t("title")}
          </h1>
          <p className="mt-1 max-w-[640px] text-[12.5px] text-ink-dim">{t("subtitle")}</p>
        </div>
        <button
          onClick={() => setLive((v) => !v)}
          className={cn(
            "glass flex w-fit items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold transition-colors",
            live ? "text-[#6ee7b7]" : "text-ink-dim hover:text-white",
          )}
        >
          {live ? <Radio size={14} strokeWidth={2.4} /> : <RefreshCw size={14} strokeWidth={2.4} />}
          {t("live")}
        </button>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-[13px] text-ink-dim">{t("loading")}</div>
      ) : !events || events.length === 0 ? (
        <div className="glass flex flex-col items-center gap-2 rounded-2xl px-6 py-16 text-center">
          <ScrollText size={30} strokeWidth={1.6} className="text-[#5c5c6e]" />
          <div className="text-[15px] font-bold">{t("empty.title")}</div>
          <div className="max-w-[420px] text-[12.5px] text-ink-dim">{t("empty.hint")}</div>
        </div>
      ) : (
        <ol className="relative flex flex-col gap-2">
          {/* connector rail behind the dots */}
          <div className="absolute bottom-4 left-[11px] top-4 w-px bg-white/[0.08]" />
          {events.map((e) => (
            <EventRow
              key={e.id}
              event={e}
              expanded={expanded === e.id}
              onToggle={() => setExpanded((cur) => (cur === e.id ? null : e.id))}
              statusLabel={t(`statuses.${e.status}`)}
              fieldLabels={{
                when: t("field.when"),
                actor: t("field.actor"),
                category: t("field.category"),
                details: t("field.details"),
              }}
            />
          ))}
        </ol>
      )}
    </div>
  );
}
