/**
 * In-process event bus bridging the job loop (runner.ts) to the local web UI
 * (ui.ts). The runner emits structured activity events; the UI streams them to
 * the browser over SSE. A small ring buffer lets a UI that connects mid-run
 * replay recent activity.
 */
import { EventEmitter } from "node:events";

export interface AgentEvent {
  ts: number;
  type: string;
  [key: string]: unknown;
}

const BUFFER_MAX = 300;
const buffer: AgentEvent[] = [];

export const bus = new EventEmitter();

/** Record + broadcast an agent activity event. */
export function emit(type: string, data: Record<string, unknown> = {}): void {
  const event: AgentEvent = { ts: Date.now(), type, ...data };
  buffer.push(event);
  if (buffer.length > BUFFER_MAX) buffer.shift();
  bus.emit("event", event);
}

/** Snapshot of buffered events, for a UI client that just connected. */
export function recentEvents(): AgentEvent[] {
  return buffer.slice();
}
