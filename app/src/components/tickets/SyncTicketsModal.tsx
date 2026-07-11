import { motion } from "framer-motion";
import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/Button";
import { MultiSelect, Select } from "@/components/ui/Dropdown";
import { PROVIDER_META } from "@/components/settings/providerMeta";
import {
  useConnectionSprints,
  useConnectionWorkItemMetadata,
  useSyncTickets,
} from "@/hooks/queries";
import type { ProviderKind, SyncRequest } from "@/types/api";

type SyncMode = "sprint" | "assigned" | "all";

/** Basic-tab scope options — each maps to a backend sync `mode`. */
const SCOPES: { id: SyncMode; label: string; sub: string }[] = [
  { id: "sprint", label: "Active sprint", sub: "Pull the current sprint's tickets" },
  { id: "assigned", label: "My assigned", sub: "Everything assigned to you" },
  { id: "all", label: "All open tickets", sub: "Every open item in the project" },
];

const segStyle = (on: boolean) =>
  "flex-1 rounded-[9px] border-none px-2 py-[9px] text-[12.5px] font-semibold cursor-pointer " +
  (on
    ? "bg-[rgba(139,92,246,.2)] text-white shadow-[inset_0_0_0_1px_rgba(139,92,246,.3)]"
    : "bg-transparent text-[#a0a0b2]");

/**
 * Sync-tickets dialog (Basic / Advanced), matching the design's provider-aware
 * modal. Basic picks a scope (mode); Advanced filters by fields that are
 * **reflected by the selected connection's provider** — the options come from
 * `/connections/{id}/work-item-metadata` + `/sprints`, so ADO shows area
 * path / states / work-item types, Jira shows its statuses / issue types, etc.
 * Fields with no options for the provider are hidden.
 */
export function SyncTicketsModal({
  connectionId,
  providerKind,
  sourceLabel,
  onClose,
}: {
  connectionId: number | null;
  providerKind?: ProviderKind;
  sourceLabel: string;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"basic" | "advanced">("basic");
  const [mode, setMode] = useState<SyncMode>("sprint");
  const [sprintPath, setSprintPath] = useState<string | null>(null);
  const [areaPath, setAreaPath] = useState<string | null>(null);
  const [states, setStates] = useState<string[]>([]);
  const [workItemTypes, setWorkItemTypes] = useState<string[]>([]);

  const { data: metadata } = useConnectionWorkItemMetadata(connectionId);
  const { data: sprints } = useConnectionSprints(connectionId);
  const sync = useSyncTickets();

  const meta = providerKind ? PROVIDER_META[providerKind] : null;
  const isAdo = providerKind === "ado";

  const sprintOptions = (sprints ?? []).map((s) => ({ value: s.path, label: s.name }));
  const areaOptions = (metadata?.areaPaths ?? []).map((a) => ({ value: a.path, label: a.name, hint: a.path }));
  const stateOptions = (metadata?.states ?? []).map((s) => ({ value: s, label: s }));
  const typeOptions = (metadata?.workItemTypes ?? []).map((t) => ({ value: t, label: t }));
  const hasAdvancedFields =
    sprintOptions.length > 0 ||
    (isAdo && areaOptions.length > 0) ||
    stateOptions.length > 0 ||
    typeOptions.length > 0;

  const runSync = () => {
    const sprintName = sprintPath
      ? (sprints ?? []).find((s) => s.path === sprintPath)?.name
      : undefined;
    const req: SyncRequest = {
      connectionId: connectionId ?? undefined,
      providerKind,
      // A specific sprint chosen in Advanced is inherently sprint-scoped.
      mode: sprintPath ? "sprint" : mode,
      sprint: sprintName,
      sprintPath: sprintPath ?? undefined,
      areaPath: isAdo ? areaPath ?? undefined : undefined,
      states,
      workItemTypes,
    };
    sync.mutate(req, {
      onSuccess: (res) => {
        toast.success(`Synced ${res.synced} ticket${res.synced === 1 ? "" : "s"}`);
        onClose();
      },
      onError: (err) => toast.error(err instanceof Error ? err.message : "Sync failed"),
    });
  };

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: "rgba(6,6,10,.62)", backdropFilter: "blur(7px)" }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-[min(560px,94vw)] overflow-hidden rounded-[22px] border border-white/[0.11]"
        style={{ background: "rgba(22,22,30,.94)", backdropFilter: "blur(40px)", boxShadow: "0 40px 90px -20px rgba(0,0,0,.8)" }}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] p-[20px_24px]">
          <div
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px] text-[15px] font-black"
            style={{ background: meta?.color ?? "#8b5cf6", color: meta?.glyphColor ?? "#fff" }}
          >
            {meta?.glyph ?? "?"}
          </div>
          <div className="flex-1">
            <div className="text-[17px] font-extrabold">Sync tickets</div>
            <div className="text-[12px] text-ink-dim">Pull from {sourceLabel}</div>
          </div>
        </div>

        <div className="p-[16px_24px_4px]">
          <div className="flex gap-1.5 rounded-[11px] border border-white/[0.07] bg-white/[0.04] p-1">
            <button className={segStyle(tab === "basic")} onClick={() => setTab("basic")}>
              Basic
            </button>
            <button className={segStyle(tab === "advanced")} onClick={() => setTab("advanced")}>
              Advanced
            </button>
          </div>
        </div>

        <div className="max-h-[56vh] overflow-y-auto p-[16px_24px_20px]">
          {tab === "basic" ? (
            <>
              <div className="mb-2.5 text-[11px] font-bold tracking-[0.06em] text-[#6c6c7e]">
                WHAT TO PULL
              </div>
              <div className="flex flex-col gap-2">
                {SCOPES.map((o) => {
                  const on = mode === o.id;
                  return (
                    <div
                      key={o.id}
                      onClick={() => setMode(o.id)}
                      className="flex cursor-pointer items-center gap-3 rounded-[12px] border p-[13px]"
                      style={{
                        borderColor: on ? "rgba(139,92,246,.4)" : "rgba(255,255,255,.08)",
                        background: on ? "rgba(139,92,246,.1)" : "rgba(255,255,255,.03)",
                      }}
                    >
                      <div
                        className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2"
                        style={{ borderColor: on ? "#8b5cf6" : "rgba(255,255,255,.2)" }}
                      >
                        {on && <span className="h-2 w-2 rounded-full bg-[#8b5cf6]" />}
                      </div>
                      <div className="flex-1">
                        <div className="text-[14px] font-semibold">{o.label}</div>
                        <div className="text-[12px] text-ink-dim">{o.sub}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="mb-2.5 text-[11px] font-bold tracking-[0.06em] text-[#6c6c7e]">
                FILTER BY FIELD
              </div>
              {hasAdvancedFields ? (
                <div className="grid grid-cols-2 gap-x-2.5 gap-y-3">
                  {sprintOptions.length > 0 && (
                    <Field label="Sprint">
                      <Select value={sprintPath} options={sprintOptions} placeholder="Any" onChange={setSprintPath} />
                    </Field>
                  )}
                  {isAdo && areaOptions.length > 0 && (
                    <Field label="Area path">
                      <Select value={areaPath} options={areaOptions} placeholder="Any" onChange={setAreaPath} />
                    </Field>
                  )}
                  {stateOptions.length > 0 && (
                    <Field label={isAdo ? "States" : "Status"}>
                      <MultiSelect values={states} options={stateOptions} placeholder="Any" onChange={setStates} />
                    </Field>
                  )}
                  {typeOptions.length > 0 && (
                    <Field label={isAdo ? "Work item types" : "Issue type"}>
                      <MultiSelect values={workItemTypes} options={typeOptions} placeholder="Any" onChange={setWorkItemTypes} />
                    </Field>
                  )}
                </div>
              ) : (
                <div className="rounded-[12px] border border-dashed border-white/[0.14] p-4 text-center text-[12.5px] text-ink-dim">
                  No filterable fields for this provider — use Basic scope, or connect a work-item
                  provider that exposes fields.
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-2.5 border-t border-white/[0.07] p-[16px_24px]">
          <span className="flex-1 text-[11.5px] text-[#7a7a8c]">Credentials stay encrypted</span>
          <Button variant="glass" onClick={onClose} disabled={sync.isPending}>
            Cancel
          </Button>
          <Button onClick={runSync} disabled={sync.isPending || connectionId == null}>
            <RefreshCw size={14} className={sync.isPending ? "animate-[spin_.7s_linear_infinite]" : ""} />
            {sync.isPending ? "Syncing…" : "Sync now"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}

/** Labeled field wrapper for the Advanced filter grid. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11.5px] font-semibold text-[#9494a6]">{label}</div>
      {children}
    </div>
  );
}
