import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";

const KEY = ["ai", "activity"] as const;

/**
 * Live Claude CLI activity. Polls while a call is running and also subscribes to
 * the /ws/ai channel so start/end events refresh immediately — giving the UI a
 * real signal that the CLI is working (not hung).
 */
export function useAiActivity() {
  const qc = useQueryClient();

  const query = useQuery({
    queryKey: KEY,
    queryFn: api.aiActivity,
    refetchInterval: (q) => ((q.state.data?.running?.length ?? 0) > 0 ? 1500 : false),
    staleTime: 0,
  });

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout>;
    const connect = () => {
      if (closed) return;
      ws = new WebSocket(api.aiWsUrl());
      ws.onopen = () => (retry = 0);
      ws.onmessage = () => qc.invalidateQueries({ queryKey: KEY });
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
  }, [qc]);

  return query;
}
