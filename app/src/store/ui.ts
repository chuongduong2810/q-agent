/**
 * UI-only client state (Zustand). Server state lives in TanStack Query — this
 * store holds navigation, selections, modal/panel open-state, search/filter and
 * in-progress edit drafts. Mirrors the interaction model of the design prototype.
 */

import { create } from "zustand";
import type { Screen } from "@/types";
import type { TestStep } from "@/types/api";

/** Sidebar nav → screen mapping; screens not in the nav (ticket/run/comment) are pushed programmatically. */
export type TicketFilter = "all" | "ready" | "mine" | "sprint";
export type EvidenceTab = "screenshot" | "video" | "trace" | "console" | "network";
export type AnnotationTool = "cursor" | "rectangle" | "arrow" | "highlight" | "circle" | "text";

export interface CaseDraft {
  title: string;
  precondition: string;
  steps: TestStep[];
}

interface UIState {
  // navigation
  screen: Screen;
  activeProject: string;
  activeTicket: string | null;
  activeRunId: number | null;
  navigate: (screen: Screen) => void;
  openTicket: (externalId: string) => void;
  openProject: (name: string) => void;
  setActiveRun: (runId: number | null) => void;

  // command palette
  paletteOpen: boolean;
  paletteQuery: string;
  openPalette: () => void;
  closePalette: () => void;
  togglePalette: () => void;
  setPaletteQuery: (q: string) => void;

  // tickets page
  selected: Record<string, boolean>;
  ticketSearch: string;
  ticketFilter: TicketFilter;
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelected: () => void;
  setTicketSearch: (q: string) => void;
  setTicketFilter: (f: TicketFilter) => void;

  // create-run modal
  createRunOpen: boolean;
  runScope: "single" | "selected" | "assigned" | "sprint";
  runFramework: string;
  runBrowser: string;
  runEnv: string;
  runWorkers: number;
  runRetry: number;
  openCreateRun: () => void;
  closeCreateRun: () => void;
  setRunField: <K extends keyof RunFormFields>(key: K, value: RunFormFields[K]) => void;

  // review
  reviewOpenTicket: string | null;
  expandedCase: number | null;
  editingCase: number | null;
  draft: CaseDraft | null;
  toggleReviewTicket: (tid: string) => void;
  toggleCase: (caseId: number) => void;
  startEdit: (caseId: number, draft: CaseDraft) => void;
  updateDraft: (patch: Partial<CaseDraft>) => void;
  cancelEdit: () => void;

  // automation
  selectedSpecCaseId: number | null;
  selectSpec: (caseId: number) => void;

  // evidence
  evidenceTicket: string | null;
  evidenceTab: EvidenceTab;
  tool: AnnotationTool;
  setEvidenceTicket: (tid: string) => void;
  setEvidenceTab: (t: EvidenceTab) => void;
  setTool: (t: AnnotationTool) => void;
}

interface RunFormFields {
  runScope: UIState["runScope"];
  runFramework: string;
  runBrowser: string;
  runEnv: string;
  runWorkers: number;
  runRetry: number;
}

export const useUI = create<UIState>((set) => ({
  screen: "dashboard",
  activeProject: "Surency Platform",
  activeTicket: null,
  activeRunId: null,
  navigate: (screen) => set({ screen, paletteOpen: false }),
  openTicket: (externalId) => set({ activeTicket: externalId, screen: "ticket" }),
  openProject: (name) => set({ activeProject: name, screen: "tickets" }),
  setActiveRun: (runId) => set({ activeRunId: runId }),

  paletteOpen: false,
  paletteQuery: "",
  openPalette: () => set({ paletteOpen: true, paletteQuery: "" }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen, paletteQuery: "" })),
  setPaletteQuery: (q) => set({ paletteQuery: q }),

  selected: {},
  ticketSearch: "",
  ticketFilter: "all",
  toggleSelected: (id) => set((s) => ({ selected: { ...s.selected, [id]: !s.selected[id] } })),
  setSelected: (ids) => set({ selected: Object.fromEntries(ids.map((id) => [id, true])) }),
  clearSelected: () => set({ selected: {} }),
  setTicketSearch: (q) => set({ ticketSearch: q }),
  setTicketFilter: (f) => set({ ticketFilter: f }),

  createRunOpen: false,
  runScope: "selected",
  runFramework: "Playwright",
  runBrowser: "chromium",
  runEnv: "Staging",
  runWorkers: 4,
  runRetry: 2,
  openCreateRun: () => set({ createRunOpen: true }),
  closeCreateRun: () => set({ createRunOpen: false }),
  setRunField: (key, value) => set({ [key]: value } as Partial<UIState>),

  reviewOpenTicket: null,
  expandedCase: null,
  editingCase: null,
  draft: null,
  toggleReviewTicket: (tid) =>
    set((s) => ({ reviewOpenTicket: s.reviewOpenTicket === tid ? null : tid })),
  toggleCase: (caseId) => set((s) => ({ expandedCase: s.expandedCase === caseId ? null : caseId })),
  startEdit: (caseId, draft) => set({ editingCase: caseId, expandedCase: caseId, draft }),
  updateDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
  cancelEdit: () => set({ editingCase: null, draft: null }),

  selectedSpecCaseId: null,
  selectSpec: (caseId) => set({ selectedSpecCaseId: caseId }),

  evidenceTicket: null,
  evidenceTab: "screenshot",
  tool: "cursor",
  setEvidenceTicket: (tid) => set({ evidenceTicket: tid }),
  setEvidenceTab: (t) => set({ evidenceTab: t }),
  setTool: (t) => set({ tool: t }),
}));
