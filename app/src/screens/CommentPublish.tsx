import { motion } from "framer-motion";
import { FileText, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { GlassCard } from "@/components/ui/GlassCard";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { Pill, providerGlyph } from "@/components/ui/badges";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { useComments, useCommentMutations, useRun } from "@/hooks/queries";
import { useRunSocket } from "@/hooks/useRunSocket";
import { useUI } from "@/store/ui";
import type { PublishStatus, TicketCommentOut } from "@/types/api";

const PUBLISH_STATUS: Record<PublishStatus, [string, string, string]> = {
  draft: ["#a0a0b2", "Draft", "rgba(255,255,255,.06)"],
  publishing: ["#fbbf24", "Publishing…", "rgba(251,191,36,.14)"],
  published: ["#6ee7b7", "Published", "rgba(16,185,129,.14)"],
  failed: ["#fb7185", "Failed", "rgba(244,63,94,.14)"],
};

/** Ticket Comments / Publish — prepares AI-summarized result comments per ticket
 * and publishes them back to the provider work item. Design: Q-Agent.dc.html 489-506. */
export function CommentPublish() {
  const activeRunId = useUI((s) => s.activeRunId);
  const { data: run } = useRun(activeRunId);
  const { data: comments, isLoading } = useComments(activeRunId);
  const { prepare, publishOne, publishAll, retry } = useCommentMutations(activeRunId ?? 0);
  useRunSocket(activeRunId);

  const anyFailed = (comments ?? []).some((c) => c.status === "failed");

  if (!activeRunId) {
    return (
      <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
        <EmptyState
          icon={<Sparkles size={30} className="text-violet" />}
          title="No active run"
          body="Publish results from a run once its suite has executed."
        />
      </div>
    );
  }

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-3.5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            {run?.code} &middot; publish results to each work item
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Ticket Comments</h1>
        </div>
        <div className="flex gap-2.5">
          {anyFailed && (
            <Button variant="danger" onClick={() => retry.mutate()} disabled={retry.isPending}>
              Retry failed
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() =>
              publishAll.mutate([], {
                onSuccess: () => toast.success("Publishing results to tickets"),
                onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
              })
            }
            disabled={publishAll.isPending || !comments?.length}
          >
            {publishAll.isPending ? (
              <>
                <Spinner size={14} className="border-white/40 border-t-white" /> Publishing…
              </>
            ) : (
              <>
                <Send size={15} strokeWidth={2.2} /> Publish all
              </>
            )}
          </Button>
        </div>
      </div>

      <div className="mb-4">
        <PipelineRail stage={8} />
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass h-[132px] animate-pulse rounded-[18px]" />
          ))}
        </div>
      ) : !comments?.length ? (
        <EmptyState
          icon={<FileText size={30} color="#7a7a8c" strokeWidth={1.8} />}
          title="No comments prepared"
          body="Generate a report, then prepare AI-summarized result comments for each ticket in the run."
          action={
            <Button
              variant="primary"
              size="lg"
              onClick={() =>
                prepare.mutate(undefined, {
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Prepare failed"),
                })
              }
              disabled={prepare.isPending}
            >
              {prepare.isPending ? <Spinner size={14} /> : <Sparkles size={16} />} Prepare comments
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {comments.map((c, i) => (
            <PublishCard
              key={c.id}
              comment={c}
              index={i}
              onPublish={() =>
                publishOne.mutate(c.id, {
                  onError: (e) => toast.error(e instanceof Error ? e.message : "Publish failed"),
                })
              }
              publishing={publishOne.isPending && (publishOne.variables as number) === c.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PublishCard({
  comment,
  index,
  onPublish,
  publishing,
}: {
  comment: TicketCommentOut;
  index: number;
  onPublish: () => void;
  publishing: boolean;
}) {
  const [glyph, glyphBg] = providerGlyph[comment.providerKind] ?? ["?", "#6b7280"];
  const [color, label, bg] = PUBLISH_STATUS[comment.status] ?? PUBLISH_STATUS.draft;
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.3), ease: "easeOut" }}
    >
      <GlassCard className="overflow-hidden">
        <div className="flex items-center gap-3 border-b border-white/[0.06] p-[15px_18px]">
          <div
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[9px] text-[13px] font-black text-white"
            style={{ background: glyphBg }}
          >
            {glyph}
          </div>
          <span className="font-mono text-[12px] font-semibold text-violet">
            {comment.ticketExternalId}
          </span>
          <span className="flex-1" />
          <Pill color={color} bg={bg}>
            {publishing ? "Publishing…" : label}
          </Pill>
          <Button variant="glass" size="sm" onClick={onPublish} disabled={publishing}>
            Publish
          </Button>
        </div>
        <div className="whitespace-pre-wrap p-[14px_18px] text-[13px] leading-[1.6] text-ink-soft">
          {comment.body}
        </div>
        {comment.errorMessage && (
          <div className="px-[18px] pb-2 text-[12px] text-danger-soft">{comment.errorMessage}</div>
        )}
        <div className="flex flex-wrap gap-2 p-[0_18px_14px]">
          <AttachmentChip label="evidence.zip" />
          <AttachmentChip label="trace.zip" />
          {comment.targetStatus && (
            <span className="rounded-[9px] border border-white/[0.09] bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-ink-soft">
              → {comment.targetStatus}
            </span>
          )}
        </div>
      </GlassCard>
    </motion.div>
  );
}

function AttachmentChip({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 rounded-[9px] border border-white/[0.09] bg-white/[0.05] px-2.5 py-1.5 text-[11.5px] text-ink-soft">
      <FileText size={13} color="#a78bfa" strokeWidth={2} />
      {label}
    </span>
  );
}
