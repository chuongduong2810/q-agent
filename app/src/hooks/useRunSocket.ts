import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/queryKeys";
import type { ProgressEvent } from "@/types/api";

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
