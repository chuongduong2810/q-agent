import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ExecCaseStatus, ExecutionOut, ProgressEvent } from "@/types/api";

/**
 * Subscribe to a run's live progress WebSocket. On each event we invalidate the
 * relevant TanStack Query caches so screens re-render with fresh server state,
 * and forward the event to an optional handler for transient UI (toasts,
 * streaming phase text). Automatically reconnects with backoff.
 */
export function useRunSocket(
  runId: number | string | null | undefined,
  onEvent?: (evt: ProgressEvent) => void,
): void {
  const qc = useQueryClient();
  const handlerRef = useRef(onEvent);
  handlerRef.current = onEvent;

  useEffect(() => {
    if (runId == null) return;
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;

    const connect = () => {
      if (closed) return;
      ws = new WebSocket(api.wsUrl(runId));
      ws.onopen = () => {
        retry = 0;
      };
      ws.onmessage = (msg) => {
        let evt: ProgressEvent;
        try {
          evt = JSON.parse(msg.data as string) as ProgressEvent;
        } catch {
          return;
        }
        handlerRef.current?.(evt);
        // Refresh the caches most affected by pipeline/exec events.
        qc.invalidateQueries({ queryKey: queryKeys.run(runId) });
        if (evt.event.startsWith("analysis") || evt.event === "run.status") {
          qc.invalidateQueries({ queryKey: queryKeys.runCases(runId) });
        }
        if (evt.event.startsWith("automation")) {
          qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
        }
        if (evt.event.startsWith("explore")) {
          // Exploration enriches the KB, which can unblock a case — refresh the
          // specs + cases so a `blocked` case reflects any new grounding.
          qc.invalidateQueries({ queryKey: queryKeys.specs(runId) });
          qc.invalidateQueries({ queryKey: queryKeys.runCases(runId) });
        }
        if (evt.event.startsWith("exec")) {
          // Optimistic: apply the event straight to the execution cache so a
          // spec's status dot / counters flip the instant the event arrives —
          // no waiting on the refetch round-trip (the invalidate below still
          // reconciles against the server a moment later).
          if (evt.event === "exec.case.result") {
            const p = evt.payload as { ticket?: string; caseCode?: string; status?: string; durationMs?: number };
            qc.setQueryData<ExecutionOut>(queryKeys.execution(runId), (old) => {
              if (!old) return old;
              let hit = false;
              const results = old.results.map((r) => {
                if (hit || !p.caseCode || r.caseCode !== p.caseCode) return r;
                // The event's ticket may be a short id ("1428" vs "SUR-1428"); match by suffix.
                if (p.ticket && r.ticketExternalId !== p.ticket && !r.ticketExternalId.endsWith(p.ticket)) return r;
                hit = true;
                return { ...r, status: (p.status as ExecCaseStatus) ?? r.status, durationMs: p.durationMs ?? r.durationMs };
              });
              return hit ? { ...old, results } : old;
            });
          } else if (evt.event === "exec.progress" || evt.event === "exec.done") {
            const p = evt.payload as { passed?: number; failed?: number; progress?: number };
            qc.setQueryData<ExecutionOut>(queryKeys.execution(runId), (old) =>
              old
                ? {
                    ...old,
                    passed: typeof p.passed === "number" ? p.passed : old.passed,
                    failed: typeof p.failed === "number" ? p.failed : old.failed,
                    progress: evt.event === "exec.done" ? 100 : typeof p.progress === "number" ? p.progress : old.progress,
                  }
                : old,
            );
          }
          qc.invalidateQueries({ queryKey: queryKeys.execution(runId) });
        }
        if (evt.event.startsWith("publish")) {
          qc.invalidateQueries({ queryKey: queryKeys.comments(runId) });
        }
      };
      ws.onclose = () => {
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(1000 * retry, 5000));
      };
      ws.onerror = () => ws?.close();
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [runId, qc]);
}
