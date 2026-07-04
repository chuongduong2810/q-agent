import { motion } from "framer-motion";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { useCreateRun, useSettings, useTickets } from "@/hooks/queries";
import { useUI } from "@/store/ui";

const FRAMEWORKS = ["Playwright", "Selenium"];
const ENVS = ["Staging", "Production", "Local"];

const segStyle = (on: boolean) =>
  "flex-1 rounded-[10px] border-none px-2 py-[9px] text-[12.5px] font-semibold cursor-pointer " +
  (on ? "bg-[rgba(139,92,246,.2)] text-white shadow-[inset_0_0_0_1px_rgba(139,92,246,.3)]" : "bg-white/[0.05] text-[#a0a0b2]");

/** Create-Run modal: scope/framework/env/workers, wired to POST /runs. */
export function CreateRunModal() {
  const open = useUI((s) => s.createRunOpen);
  const closeCreateRun = useUI((s) => s.closeCreateRun);
  const runScope = useUI((s) => s.runScope);
  const runFramework = useUI((s) => s.runFramework);
  const runEnv = useUI((s) => s.runEnv);
  const runWorkers = useUI((s) => s.runWorkers);
  const runRetry = useUI((s) => s.runRetry);
  const runBrowser = useUI((s) => s.runBrowser);
  const setRunField = useUI((s) => s.setRunField);
  const selected = useUI((s) => s.selected);
  const setActiveRun = useUI((s) => s.setActiveRun);
  const navigate = useUI((s) => s.navigate);
  const selectedSprint = useUI((s) => s.selectedSprint);

  const { data: tickets } = useTickets();
  const { data: settings } = useSettings();
  const userName = (settings?.userName ?? "").trim();
  const createRun = useCreateRun();

  if (!open) return null;

  const selN = Object.values(selected).filter(Boolean).length;
  const sprintName = selectedSprint?.name;
  const sprintN = sprintName ? (tickets ?? []).filter((t) => t.sprint === sprintName).length : 0;
  const assignedN = userName ? (tickets ?? []).filter((t) => t.assignee === userName).length : 0;

  // "My assigned tickets" is only offered once an identity is configured.
  const scopeOptions = [
    { id: "selected" as const, label: "Selected tickets", sub: "Only the tickets you picked on the Tickets page", count: `${selN} selected` },
    {
      id: "sprint" as const,
      label: sprintName ? `Entire ${sprintName}` : "Entire sprint",
      sub: sprintName ? "Every ticket in the chosen sprint" : "Pick a sprint on the Tickets page first",
      count: `${sprintN} tickets`,
    },
    { id: "assigned" as const, label: "My assigned tickets", sub: "All tickets assigned to you", count: `${assignedN} tickets` },
  ].filter((o) => o.id !== "assigned" || !!userName);

  const createSummary =
    (runScope === "selected" ? `${selN} selected tickets` : runScope === "sprint" ? `${sprintN} sprint tickets` : `${assignedN} assigned tickets`) +
    ` · ${runFramework} · ${runEnv}`;

  const handleStart = () => {
    createRun.mutate(
      {
        scope: runScope,
        ticketIds: runScope === "selected" ? Object.keys(selected).filter((k) => selected[k]) : [],
        framework: runFramework,
        browser: runBrowser,
        env: runEnv,
        workers: runWorkers,
        retryPolicy: runRetry,
        sprint: runScope === "sprint" ? selectedSprint?.name : undefined,
        sprintPath: runScope === "sprint" ? selectedSprint?.path : undefined,
      },
      {
        onSuccess: (run) => {
          closeCreateRun();
          setActiveRun(run.id);
          navigate("run");
        },
        onError: (err) => toast.error(err instanceof Error ? err.message : "Failed to create run"),
      },
    );
  };

  return (
    <div
      onClick={closeCreateRun}
      className="fixed inset-0 z-50 flex items-center justify-center p-5"
      style={{ background: "rgba(6,6,10,.62)", backdropFilter: "blur(7px)" }}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="w-[min(600px,94vw)] overflow-hidden rounded-[22px] border border-white/[0.11]"
        style={{ background: "rgba(22,22,30,.94)", backdropFilter: "blur(40px)", boxShadow: "0 40px 90px -20px rgba(0,0,0,.8)" }}
      >
        <div className="flex items-center gap-3 border-b border-white/[0.07] p-[20px_24px]">
          <div className="accent-gradient flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-[11px]">
            <Plus size={18} color="#fff" strokeWidth={2.4} />
          </div>
          <div className="flex-1">
            <div className="text-[17px] font-extrabold">Create a Run</div>
            <div className="text-[12px] text-ink-dim">A batch QA session across one or many tickets</div>
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-[22px_24px]">
          <div className="mb-2.5 text-[12px] font-semibold text-[#9494a6]">SCOPE</div>
          <div className="mb-5 flex flex-col gap-2">
            {scopeOptions.map((o) => {
              const on = runScope === o.id;
              return (
                <div
                  key={o.id}
                  onClick={() => setRunField("runScope", o.id)}
                  className="flex cursor-pointer items-center gap-[13px] rounded-[13px] border p-[14px]"
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
                  <span className="text-[12px] font-bold text-violet">{o.count}</span>
                </div>
              );
            })}
          </div>

          <div className="mb-5 grid grid-cols-2 gap-4">
            <div>
              <div className="mb-2.5 text-[12px] font-semibold text-[#9494a6]">FRAMEWORK</div>
              <div className="flex gap-2">
                {FRAMEWORKS.map((f) => (
                  <button key={f} onClick={() => setRunField("runFramework", f)} className={segStyle(runFramework === f)}>
                    {f}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2.5 text-[12px] font-semibold text-[#9494a6]">ENVIRONMENT</div>
              <div className="flex gap-2">
                {ENVS.map((e) => (
                  <button key={e} onClick={() => setRunField("runEnv", e)} className={segStyle(runEnv === e)}>
                    {e}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between py-0.5">
            <div>
              <div className="text-[14px] font-semibold">Parallel workers</div>
              <div className="text-[12px] text-ink-dim">Execute up to {runWorkers} cases at once</div>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min={1}
                max={8}
                value={runWorkers}
                onChange={(e) => setRunField("runWorkers", Number(e.target.value))}
                className="w-[140px] accent-violet-500"
              />
              <span className="w-5 text-center font-mono text-[14px] font-bold">{runWorkers}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-[10px] border-t border-white/[0.07] p-[16px_24px]">
          <span className="flex-1 text-[12.5px] text-ink-dim">{createSummary}</span>
          <Button variant="glass" onClick={closeCreateRun}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleStart} disabled={createRun.isPending}>
            {createRun.isPending ? "Starting…" : "Start Run"}
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
