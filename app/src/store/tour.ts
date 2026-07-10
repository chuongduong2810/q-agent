/**
 * Interactive product-tour state (Zustand) — a small self-contained state
 * machine, kept out of `store/ui.ts` (which holds ephemeral per-screen UI) so
 * the tour's lifecycle (auto-start, cross-route sequencing, localStorage) and
 * its subscribers stay isolated. Follows the one-store-per-concern precedent of
 * `store/auth.ts`.
 *
 * The declarative step list lives in `@/tour/tourSteps` (it references icons /
 * JSX), not here — this store stays logic-only. `next()` increments without an
 * upper clamp; `TourOverlay` detects `stepIndex >= steps.length` and calls
 * `stop(true)` to finish, so the store need not import the step config.
 */

import { create } from "zustand";

/** localStorage key marking that a user has seen (or dismissed) the tour once.
 * Uses the existing `qagent.*` convention (see `screens/CreateLinkSync.tsx`). */
const SEEN_KEY = "qagent.tourSeen";

/** True once the tour has been completed or skipped on this device. */
export function hasSeenTour(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

function markSeenFlag(): void {
  try {
    localStorage.setItem(SEEN_KEY, "1");
  } catch {
    /* private-mode / storage-disabled — non-fatal, the tour just re-shows */
  }
}

interface TourState {
  /** Whether the tour overlay is currently showing. */
  active: boolean;
  /** 0-based index into the `@/tour/tourSteps` array. */
  stepIndex: number;
  /** The seeded sample run's id, resolved lazily when the tour reaches the
   * live-run section (see `TourOverlay`'s bridge step). Null until then. */
  sampleRunId: number | null;

  /** Begin the tour from the first step. */
  start: () => void;
  /** End the tour. When `markSeen` (default true) the localStorage flag is set
   * so it won't auto-start again. */
  stop: (markSeen?: boolean) => void;
  /** Advance one step (unbounded — the overlay finishes at the end). */
  next: () => void;
  /** Go back one step (clamped at 0). */
  prev: () => void;
  /** Jump to a specific step index. */
  goToIndex: (i: number) => void;
  /** Record the resolved sample-run id for run-scoped step routes. */
  setSampleRunId: (id: number | null) => void;
}

export const useTour = create<TourState>((set) => ({
  active: false,
  stepIndex: 0,
  sampleRunId: null,

  start: () => set({ active: true, stepIndex: 0 }),
  stop: (markSeen = true) => {
    if (markSeen) markSeenFlag();
    set({ active: false });
  },
  next: () => set((s) => ({ stepIndex: s.stepIndex + 1 })),
  prev: () => set((s) => ({ stepIndex: Math.max(0, s.stepIndex - 1) })),
  goToIndex: (i) => set({ stepIndex: Math.max(0, i) }),
  setSampleRunId: (id) => set({ sampleRunId: id }),
}));
