import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRunEvents } from "@/hooks/useRunEvents";
import { queryKeys } from "@/lib/queryKeys";
import { toast } from "@/lib/toast";
import type { ProgressEvent } from "@/types/api";

/** Latest automation.progress detail for the "Generating…" banner. */
export type GenProgress = {
  done: number;
  total: number;
  file: string;
  message: string;
};

/** Live self-heal progress from the WS stream. */
export type HealProgress = {
  caseId: number;
  ticket: string;
  caseCode: string;
  attempt: number;
  maxAttempts: number;
  phase: "running" | "fixing" | "passed" | "failed";
  message: string;
  error: string;
};

/**
 * Wraps the run's WS event handling for the Automation screen: captures live
 * generation and self-heal progress for the banners, surfaces per-spec errors as
 * toasts, invalidates the relevant queries on a terminal heal phase, and clears
 * the generation banner once generation is no longer active.
 *
 * @param runId The active run's id.
 * @param generating Whether generation is currently in flight.
 * @returns The current generation and self-heal progress (or null).
 */
export function useAutomationEvents(runId: number, generating: boolean) {
  const qc = useQueryClient();

  // Latest automation.progress detail for the banner. Captured from the WS
  // stream (see onRunEvent); cleared when generation finishes.
  const [genProgress, setGenProgress] = useState<GenProgress | null>(null);

  // Live self-heal progress (from the WS stream). Cleared shortly after a
  // terminal phase (passed/failed).
  const [healProgress, setHealProgress] = useState<HealProgress | null>(null);

  // Capture live progress for the banner, surface per-spec generation errors,
  // and clear progress when the background pass finishes (run.status flips once
  // every case has been attempted).
  const onRunEvent = useCallback((evt: ProgressEvent) => {
    if (evt.event === "run.status") {
      setGenProgress(null);
      return;
    }
    if (evt.event === "automation.progress") {
      const p = evt.payload as {
        message?: string;
        file?: string;
        error?: string;
        done?: number;
        total?: number;
      };
      const message = p.error || p.message || "";
      setGenProgress({
        done: typeof p.done === "number" ? p.done : 0,
        total: typeof p.total === "number" ? p.total : 0,
        file: p.file ?? "",
        message,
      });
      if (message.toLowerCase().startsWith("error")) {
        toast.error(`${p.file ?? "spec"}: ${message}`);
      }
      return;
    }
    if (evt.event === "heal.progress") {
      const p = evt.payload as {
        caseId: number;
        ticket: string;
        caseCode: string;
        attempt: number;
        maxAttempts: number;
        phase: "running" | "fixing" | "passed" | "failed";
        message: string;
        error?: string;
      };
      setHealProgress({ ...p, error: p.error ?? "" });
      if (p.phase === "passed" || p.phase === "failed") {
        if (p.phase === "passed") toast.success(`Self-heal fixed ${p.caseCode}`);
        else toast.error(`Self-heal gave up on ${p.caseCode}: ${p.message || "still failing"}`);
        // The spec code, latest execution result, and heal trail changed on the server.
        qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
        qc.invalidateQueries({ queryKey: queryKeys.execution(runId) });
        qc.invalidateQueries({ queryKey: queryKeys.healStatus(p.caseId) });
        qc.invalidateQueries({ queryKey: queryKeys.healReport(p.caseId) });
        setTimeout(() => setHealProgress(null), 4000);
      }
    }
  }, [qc, runId]);
  useRunEvents(onRunEvent);

  // Belt-and-braces: clear the banner detail whenever generation is no longer
  // active (covers the case where the run.status event is missed).
  useEffect(() => {
    if (!generating) setGenProgress(null);
  }, [generating]);

  return { genProgress, healProgress };
}
