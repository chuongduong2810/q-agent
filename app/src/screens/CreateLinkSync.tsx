import { ArrowRight, Check, Link2, RefreshCw, Sparkles } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { PipelineRail } from "@/components/ui/PipelineRail";
import { providerGlyph } from "@/components/ui/badges";
import { EmptyState, Spinner } from "@/components/ui/misc";
import { providerLabel } from "@/data/projects";
import {
  useCreateAndLink,
  useGenerateAutomation,
  useLinkStatus,
  useRun,
  useTickets,
} from "@/hooks/queries";
import { useRunSocket } from "@/hooks/useRunSocket";
import { useUI } from "@/store/ui";
import type { LinkTicketResult, ProviderKind } from "@/types/api";

/**
 * Create & Link Test Cases — creates approved cases in the provider and links
 * them to each work item (pipeline stage between Review and Automation).
 */
export function CreateLinkSync() {
  const activeRunId = useUI((s) => s.activeRunId);
  const navigate = useUI((s) => s.navigate);
  const { data: run } = useRun(activeRunId);
  const { data: tickets } = useTickets();
  const { data: status } = useLinkStatus(activeRunId);
  const createAndLink = useCreateAndLink(activeRunId ?? 0);
  const generateAutomation = useGenerateAutomation(activeRunId ?? 0);
  useRunSocket(activeRunId);

  // Local mode: create cases locally only, never write to the live provider.
  // Persisted so the choice sticks across visits during local development.
  const [localMode, setLocalMode] = useState(
    () => localStorage.getItem("qagent.localCreateLink") === "1",
  );
  const toggleLocalMode = (on: boolean) => {
    setLocalMode(on);
    localStorage.setItem("qagent.localCreateLink", on ? "1" : "0");
  };

  const state = status?.status ?? "idle";
  const results = status?.results ?? [];
  const byTicket = new Map<string, LinkTicketResult>(results.map((r) => [r.ticketExternalId, r]));

  const runTickets = run?.runTickets ?? [];
  const providerOf = (tid: string): ProviderKind =>
    (tickets?.find((t) => t.externalId === tid)?.providerKind ??
      byTicket.get(tid)?.providerKind ??
      "ado") as ProviderKind;

  if (!activeRunId) {
    return (
      <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
        <EmptyState
          icon={<Link2 size={30} className="text-violet" />}
          title="No active run"
          body="Approve test cases in a run, then create & link them to the provider here."
        />
      </div>
    );
  }

  return (
    <div className="animate-[fadeInUp_.5s_ease_both] px-1 pb-10 pt-0.5">
      <div className="mb-3.5 flex items-end justify-between">
        <div>
          <div className="mb-[5px] text-[13px] font-medium text-ink-dim">
            {run?.code} &middot; create approved cases in the provider &amp; link to each work item
          </div>
          <h1 className="m-0 text-[28px] font-black tracking-tight">Create &amp; Link Test Cases</h1>
        </div>
        {state === "done" && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => {
              generateAutomation.mutate(undefined);
              navigate("automation");
            }}
          >
            Generate automation <ArrowRight size={15} strokeWidth={2.2} />
          </Button>
        )}
      </div>

      <div className="mb-4">
        <PipelineRail stage={5} />
      </div>

      {state === "idle" && (
        <div className="glass flex flex-col items-center rounded-[22px] px-8 py-12 text-center">
          <div
            className="mb-5 flex h-[70px] w-[70px] items-center justify-center rounded-[22px]"
            style={{ background: "linear-gradient(135deg,rgba(139,92,246,.24),rgba(99,102,241,.12))" }}
          >
            <Link2 size={30} color="#a78bfa" strokeWidth={1.9} />
          </div>
          <h2 className="m-0 mb-2 text-xl font-extrabold">Ready to create test cases</h2>
          <p className="m-0 mb-[18px] max-w-[400px] text-[13.5px] leading-relaxed text-ink-dim">
            {localMode
              ? "Local mode is on — approved cases are recorded locally only. Nothing is written to the provider."
              : "Approved cases will be created in the provider and linked to each work item before automation is generated."}
          </p>

          <label
            className="mb-[18px] flex cursor-pointer items-center gap-2.5 rounded-xl border px-[14px] py-2.5"
            style={{
              background: localMode ? "rgba(139,92,246,.12)" : "rgba(255,255,255,.03)",
              borderColor: localMode ? "rgba(139,92,246,.35)" : "rgba(255,255,255,.08)",
            }}
          >
            <input
              type="checkbox"
              className="h-4 w-4 accent-violet"
              checked={localMode}
              onChange={(e) => toggleLocalMode(e.target.checked)}
            />
            <span className="text-[13px] font-semibold text-ink-soft">
              Local mode — don&apos;t create in the provider (avoid test-item clutter)
            </span>
          </label>

          <Button
            variant="primary"
            size="lg"
            onClick={() =>
              createAndLink.mutate(
                { link: !localMode, dryRun: localMode },
                { onError: (e) => toast.error(e instanceof Error ? e.message : "Create & link failed") },
              )
            }
          >
            <Sparkles size={16} strokeWidth={2.2} />{" "}
            {localMode ? "Create locally" : "Create & link now"}
          </Button>
        </div>
      )}

      {state === "running" && (
        <div
          className="glass mb-3.5 flex items-center gap-3 rounded-[22px] p-[20px_22px]"
          style={{ borderColor: "rgba(139,92,246,.28)" }}
        >
          <RefreshCw size={20} className="animate-[spin_.8s_linear_infinite] text-violet" />
          <div>
            <div className="text-[15px] font-bold">Synchronizing with the provider</div>
            <div className="text-[12px] text-ink-dim">Creating and linking approved test cases…</div>
          </div>
        </div>
      )}

      {state === "done" && (
        <div
          className="mb-3.5 flex items-center gap-[11px] rounded-2xl p-[14px_18px]"
          style={{ background: "rgba(16,185,129,.1)", border: "1px solid rgba(16,185,129,.28)" }}
        >
          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-success">
            <Check size={15} color="#fff" strokeWidth={3} />
          </span>
          <span className="text-[14px] font-bold text-success-soft">
            {results.some((r) => r.local) ? "Created locally" : "Synchronization complete"}
          </span>
          <span className="flex-1 text-[12.5px] text-[#9fe8c8]">
            {results.some((r) => r.local)
              ? "Approved test cases were recorded locally (provider untouched). You can now generate automation."
              : "Approved test cases are created and linked. You can now generate automation."}
          </span>
        </div>
      )}

      {state !== "idle" && (
        <div className="flex flex-col gap-[11px]">
          {runTickets.map((rt) => {
            const res = byTicket.get(rt.ticketExternalId);
            const kind = providerOf(rt.ticketExternalId);
            const [glyph, glyphBg] = providerGlyph[kind] ?? ["?", "#6b7280"];
            const title =
              tickets?.find((t) => t.externalId === rt.ticketExternalId)?.title ?? rt.ticketExternalId;
            return (
              <div
                key={rt.ticketExternalId}
                className="glass flex items-center gap-3.5 rounded-2xl p-[16px_18px]"
              >
                <div
                  className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[10px] text-[14px] font-black text-white"
                  style={{ background: glyphBg }}
                >
                  {glyph}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-0.5 flex items-center gap-[9px]">
                    <span className="font-mono text-[11.5px] font-semibold text-violet">
                      {rt.ticketExternalId}
                    </span>
                    {res && <span className="text-[11px] text-[#7a7a8c]">{res.count} test cases</span>}
                  </div>
                  <div className="truncate text-[14px] font-semibold">{title}</div>
                </div>
                {res ? (
                  <div className="flex flex-col items-end gap-1">
                    {res.error ? (
                      <span className="text-[11.5px] font-bold text-danger-soft">{res.error}</span>
                    ) : (
                      <>
                        <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-success-soft">
                          <Check size={13} strokeWidth={2.6} />{" "}
                          {res.local ? "Created locally" : "Test cases created"}
                        </span>
                        {res.local ? (
                          <span className="text-[11px] font-semibold text-[#9494a6]">
                            Provider not touched
                          </span>
                        ) : (
                          res.linked && (
                            <span className="flex items-center gap-1.5 text-[11.5px] font-bold text-success-soft">
                              <Check size={13} strokeWidth={2.6} /> Linked to {providerLabel[kind]}
                            </span>
                          )
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <span className="flex items-center gap-2 text-[12px] font-semibold text-[#6b7280]">
                    <Spinner size={13} /> Pending…
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
