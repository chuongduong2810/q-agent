import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { useRunSocket } from "@/hooks/useRunSocket";
import type { ProgressEvent } from "@/types/api";

/**
 * The run WebSocket, bound to the run route. `RunSocketProvider` is mounted once
 * by `RunLayout` (`/runs/:runId`) and opens exactly ONE socket for the run via
 * `useRunSocket` — which also performs the standard TanStack Query cache
 * invalidation. Because it lives on the layout, the socket persists across
 * intra-run navigation (review → automation → execution) instead of
 * reconnecting on every screen change.
 *
 * Screen-local transient subscribers (per-ticket phase text, manual-login
 * prompts, spec/exec refresh) register a handler via `useRunEvents(handler)`;
 * the provider fans every event out to all registered handlers.
 */

type EventHandler = (evt: ProgressEvent) => void;

interface RunEventsContextValue {
  /** Register a handler; returns an unsubscribe function. */
  subscribe: (handler: EventHandler) => () => void;
}

const RunEventsContext = createContext<RunEventsContextValue | null>(null);

export function RunSocketProvider({
  runId,
  children,
}: {
  runId: number;
  children: ReactNode;
}) {
  const handlers = useRef<Set<EventHandler>>(new Set());

  // Single dispatcher for the one socket: fan each event out to every
  // screen-local subscriber. Cache invalidation is handled inside useRunSocket.
  const dispatch = useCallback((evt: ProgressEvent) => {
    handlers.current.forEach((handler) => handler(evt));
  }, []);

  useRunSocket(runId, dispatch);

  const value = useMemo<RunEventsContextValue>(
    () => ({
      subscribe: (handler) => {
        handlers.current.add(handler);
        return () => {
          handlers.current.delete(handler);
        };
      },
    }),
    [],
  );

  return <RunEventsContext.Provider value={value}>{children}</RunEventsContext.Provider>;
}

/**
 * Subscribe to the current run's live events for transient screen-local UI.
 * Must be called under a `RunSocketProvider` (i.e. inside a run route); outside
 * one it is a no-op.
 */
export function useRunEvents(handler: EventHandler): void {
  const ctx = useContext(RunEventsContext);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!ctx) return;
    return ctx.subscribe((evt) => handlerRef.current(evt));
  }, [ctx]);
}
