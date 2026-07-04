/**
 * UI-only client state (Zustand). Server state lives in TanStack Query and
 * navigation lives in the URL (react-router, see ADR 0003) — this store holds
 * only ephemeral UI state: modal/panel open-state, selections, search/filter and
 * in-progress edit drafts.
 */

import { create } from "zustand";
import type { TestStep } from "@/types/api";

export type TicketFilter = "all" | "ready" | "mine" | "sprint";
export type ProjectTab = "overview" | "knowledge" | "tickets" | "runs" | "settings";
export type EvidenceTab = "screenshot" | "video" | "trace" | "console" | "network";
export type AnnotationTool = "cursor" | "rectangle" | "arrow" | "highlight" | "circle" | "text";

export interface CaseDraft {
  title: string;
  precondition: string;
  steps: TestStep[];
}

interface UIState {
  // Project Knowledge build overlay (cosmetic step animation over the real build)
  knowledgeBuilding: boolean;
  buildProjectName: string;
  knowledgeStep: number;
  startKnowledgeBuild: (name: string) => void;
  tickKnowledgeStep: (max: number) => void;
  endKnowledgeBuild: () => void;

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
  /** The real sprint chosen in the picker (name + provider-native path/id). */
  selectedSprint: { name: string; path: string } | null;
  /** Additional ADO query filters. */
  areaPath: string | null;
  states: string[];
  workItemTypes: string[];
  toggleSelected: (id: string) => void;
  setSelected: (ids: string[]) => void;
  clearSelected: () => void;
  setTicketSearch: (q: string) => void;
  setTicketFilter: (f: TicketFilter) => void;
  setSelectedSprint: (s: { name: string; path: string } | null) => void;
  setAreaPath: (p: string | null) => void;
  setStates: (s: string[]) => void;
  setWorkItemTypes: (t: string[]) => void;

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
  expandedCase: number | null;
  editingCase: number | null;
  draft: CaseDraft | null;
  reviewSel: Record<number, boolean>;
  toggleReviewSel: (caseId: number) => void;
  clearReviewSel: () => void;
  toggleCase: (caseId: number) => void;
  startEdit: (caseId: number, draft: CaseDraft) => void;
  updateDraft: (patch: Partial<CaseDraft>) => void;
  cancelEdit: () => void;

  // evidence
  evidenceTab: EvidenceTab;
  tool: AnnotationTool;
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
  knowledgeBuilding: false,
  buildProjectName: "",
  knowledgeStep: 0,
  startKnowledgeBuild: (name) =>
    set({ knowledgeBuilding: true, buildProjectName: name, knowledgeStep: 0 }),
  tickKnowledgeStep: (max) => set((s) => ({ knowledgeStep: Math.min(s.knowledgeStep + 1, max) })),
  endKnowledgeBuild: () => set({ knowledgeBuilding: false, knowledgeStep: 0 }),

  paletteOpen: false,
  paletteQuery: "",
  openPalette: () => set({ paletteOpen: true, paletteQuery: "" }),
  closePalette: () => set({ paletteOpen: false }),
  togglePalette: () => set((s) => ({ paletteOpen: !s.paletteOpen, paletteQuery: "" })),
  setPaletteQuery: (q) => set({ paletteQuery: q }),

  selected: {},
  ticketSearch: "",
  ticketFilter: "all",
  selectedSprint: null,
  areaPath: null,
  states: [],
  workItemTypes: [],
  toggleSelected: (id) => set((s) => ({ selected: { ...s.selected, [id]: !s.selected[id] } })),
  setSelected: (ids) => set({ selected: Object.fromEntries(ids.map((id) => [id, true])) }),
  clearSelected: () => set({ selected: {} }),
  setTicketSearch: (q) => set({ ticketSearch: q }),
  setTicketFilter: (f) => set({ ticketFilter: f }),
  setSelectedSprint: (s) => set({ selectedSprint: s }),
  setAreaPath: (p) => set({ areaPath: p }),
  setStates: (s) => set({ states: s }),
  setWorkItemTypes: (t) => set({ workItemTypes: t }),

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

  expandedCase: null,
  editingCase: null,
  draft: null,
  reviewSel: {},
  toggleReviewSel: (caseId) =>
    set((s) => ({ reviewSel: { ...s.reviewSel, [caseId]: !s.reviewSel[caseId] } })),
  clearReviewSel: () => set({ reviewSel: {} }),
  toggleCase: (caseId) => set((s) => ({ expandedCase: s.expandedCase === caseId ? null : caseId })),
  startEdit: (caseId, draft) => set({ editingCase: caseId, expandedCase: caseId, draft }),
  updateDraft: (patch) => set((s) => (s.draft ? { draft: { ...s.draft, ...patch } } : {})),
  cancelEdit: () => set({ editingCase: null, draft: null }),

  evidenceTab: "screenshot",
  tool: "cursor",
  setEvidenceTab: (t) => set({ evidenceTab: t }),
  setTool: (t) => set({ tool: t }),
}));
