import { AlertTriangle, GitBranch } from "lucide-react";
import { Select } from "@/components/ui/Dropdown";
import { GlassCard } from "@/components/ui/GlassCard";
import type { KnowledgeStatus, RunTicketOut, TicketOut } from "@/types/api";

/**
 * "Target repositories" panel — one row per run work item with a repo selector.
 * Each work item defaults to the repo Claude guessed (its `repo`), falling back
 * to the project default repo when unset. Selecting a new repo invokes
 * `onChangeRepo`; the mutation + error toast are owned by the parent screen.
 */
export function TargetRepoPanel({
  runTickets,
  tickets,
  repoSelectOptions,
  repoStatusOf,
  defaultRepoName,
  onChangeRepo,
}: {
  runTickets: RunTicketOut[];
  tickets: TicketOut[] | undefined;
  repoSelectOptions: { value: string; label: string }[];
  repoStatusOf: (name: string) => KnowledgeStatus | undefined;
  defaultRepoName: string;
  onChangeRepo: (tid: string, repo: string) => void;
}) {
  return (
    <GlassCard className="mb-3.5 p-4">
      <div className="mb-1 flex items-center gap-2">
        <GitBranch size={15} className="text-violet" />
        <span className="text-[13.5px] font-bold">Target repositories</span>
      </div>
      <p className="m-0 mb-3 text-xs leading-relaxed text-muted">
        Automation reads each work item's repository knowledge base. Claude guessed a default —
        override per item if needed.
      </p>
      <div className="flex flex-col gap-2">
        {runTickets.map((rt) => {
          const title = tickets?.find((t) => t.externalId === rt.ticketExternalId)?.title ?? "";
          const selected = rt.repo || defaultRepoName;
          const status = repoStatusOf(selected);
          return (
            <div
              key={rt.ticketExternalId}
              className="flex items-center gap-3 rounded-[11px] border border-white/[0.07] bg-white/[0.03] px-3 py-2"
            >
              <span className="shrink-0 font-mono text-[12px] font-semibold text-violet">
                {rt.ticketExternalId}
              </span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{title}</span>
              {status && status !== "indexed" && (
                <span className="flex shrink-0 items-center gap-1 text-[11px] font-semibold text-warning-soft">
                  <AlertTriangle size={12} />
                  knowledge not built
                </span>
              )}
              <Select
                value={selected}
                options={repoSelectOptions}
                placeholder="Select repo"
                allowClear={false}
                onChange={(v) => {
                  if (!v || v === selected) return;
                  onChangeRepo(rt.ticketExternalId, v);
                }}
              />
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}
