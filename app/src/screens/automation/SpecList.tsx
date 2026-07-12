import { FileCode } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import type { AutomationSpecOut } from "@/types/api";
import { normalizeSpecStatus } from "./specStatus";
import { SpecStatusDot } from "./SpecStatusDot";
import type { HealProgress } from "./useAutomationEvents";

/**
 * Left "APPROVED SPECS" list. Renders a selectable row per spec with a status
 * dot; blocked specs get a dashed outline.
 */
export function SpecList({
  specs,
  selectedTestCaseId,
  resultStatusByCase,
  healProgress,
  onSelect,
}: {
  specs: AutomationSpecOut[];
  selectedTestCaseId: number | null;
  resultStatusByCase: Map<number, string>;
  healProgress: HealProgress | null;
  onSelect: (caseId: number) => void;
}) {
  return (
    <GlassCard className="p-2">
      <div className="px-2.5 pb-1.5 pt-2 text-[10.5px] font-semibold tracking-wider text-faint">
        APPROVED SPECS
      </div>
      <div className="flex flex-col gap-0.5">
        {specs.map((s) => {
          const active = selectedTestCaseId === s.testCaseId;
          const blocked = normalizeSpecStatus(s.status) === "blocked";
          return (
            <button
              key={s.id}
              onClick={() => onSelect(s.testCaseId)}
              className={`flex items-center gap-2 rounded-[10px] px-2.5 py-2 text-left hover:bg-white/5 ${
                blocked ? "border border-dashed border-white/20" : ""
              }`}
              style={active ? { background: "rgba(139,92,246,.14)" } : undefined}
            >
              <FileCode size={14} color={active ? "#a78bfa" : "#8b8b9e"} />
              <span className="flex-1 truncate font-mono text-xs text-ink-soft">{s.filename}</span>
              <SpecStatusDot
                specStatus={s.status}
                execStatus={resultStatusByCase.get(s.testCaseId)}
                healing={
                  healProgress?.caseId === s.testCaseId &&
                  healProgress?.phase !== "passed" &&
                  healProgress?.phase !== "failed"
                }
              />
            </button>
          );
        })}
      </div>
    </GlassCard>
  );
}
