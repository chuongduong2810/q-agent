import { motion } from "framer-motion";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/cn";

/**
 * The QA pipeline visualization shown on every run-scoped screen. `stage` is the
 * 1-based index of the currently-active step; earlier steps render as complete.
 */
const STAGES = [
  "Sync",
  "Select",
  "Analyze",
  "Review",
  "Link",
  "Automate",
  "Execute",
  "Evidence",
  "Publish",
] as const;

// Run.status → active stage index (1-based). Mirrors the design's runStageMap.
export const runStatusToStage: Record<string, number> = {
  processing: 3,
  review: 4,
  sync: 5,
  automation: 6,
  executing: 7,
  evidence: 8,
  comment: 9,
  done: 9,
};

export function PipelineRail({ stage }: { stage: number }) {
  const { t } = useTranslation("commands");
  return (
    <div className="glass flex items-center gap-1 overflow-x-auto rounded-[18px] px-4 py-4">
      {STAGES.map((label, i) => {
        const idx = i + 1;
        const done = idx < stage;
        const active = idx === stage;
        return (
          <div key={label} className="flex flex-1 items-center gap-1">
            <div className="flex items-center gap-2.5">
              <motion.div
                initial={false}
                animate={{ scale: active ? 1.06 : 1 }}
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                )}
                style={{
                  background: done
                    ? "#10b981"
                    : active
                      ? "linear-gradient(135deg,#8b5cf6,#6366f1)"
                      : "rgba(255,255,255,.06)",
                  color: done || active ? "#fff" : "#7a7a8c",
                  boxShadow: active ? "0 0 18px rgba(139,92,246,.6)" : undefined,
                }}
              >
                {done ? "✓" : idx}
              </motion.div>
              <span
                className="whitespace-nowrap text-[12px] font-semibold"
                style={{ color: active ? "#ececf1" : done ? "#9ca3af" : "#6c6c7e" }}
              >
                {t(`pipeline.${label.toLowerCase()}`)}
              </span>
            </div>
            {i < STAGES.length - 1 && (
              <div
                className="mx-1 h-px flex-1"
                style={{ background: done ? "rgba(16,185,129,.4)" : "rgba(255,255,255,.08)" }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
