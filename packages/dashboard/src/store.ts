import { create } from "zustand";
import type { AssessmentGraph, Finding, GapDirection, Severity } from "@assess/core";

// Single store for the dashboard. Loads assessment-graph.json once and exposes
// the current view + filters. All three views derive from the same graph; they
// only change which nodes/edges/colors are shown.

declare const __ASSESS_DEFAULT_GRAPH__: string;

export type ViewMode = "coverage" | "gap" | "findings";

export interface Filters {
  directions: Set<GapDirection>;
  minSeverity: Severity | null; // null = all
  showSatisfied: boolean;
  search: string;
}

interface DashboardState {
  graph: AssessmentGraph | null;
  loading: boolean;
  error: string | null;
  graphUrl: string;
  view: ViewMode;
  selectedNodeId: string | null;
  selectedFindingId: string | null;
  filters: Filters;
  load: (url?: string) => Promise<void>;
  setView: (v: ViewMode) => void;
  selectNode: (id: string | null) => void;
  selectFinding: (id: string | null) => void;
  toggleDirection: (d: GapDirection) => void;
  setMinSeverity: (s: Severity | null) => void;
  toggleSatisfied: () => void;
  setSearch: (s: string) => void;
}

const SEV_RANK: Record<Severity, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };

function defaultGraphUrl(): string {
  const q = new URLSearchParams(window.location.search).get("graph");
  return q || import.meta.env.VITE_GRAPH || __ASSESS_DEFAULT_GRAPH__ || "/assessment-graph.json";
}

export const useStore = create<DashboardState>((set, get) => ({
  graph: null,
  loading: false,
  error: null,
  graphUrl: defaultGraphUrl(),
  view: "coverage",
  selectedNodeId: null,
  selectedFindingId: null,
  filters: {
    directions: new Set<GapDirection>(["intent_to_code", "code_to_intent", "baseline_to_code"]),
    minSeverity: null,
    showSatisfied: false,
    search: "",
  },
  async load(url = get().graphUrl) {
    set({ loading: true, error: null, graphUrl: url });
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url}`);
      const graph = (await res.json()) as AssessmentGraph;
      if (graph.kind !== "assessment") throw new Error("not an assessment graph (kind != 'assessment')");
      set({ graph, loading: false });
    } catch (e) {
      set({ error: (e as Error).message, loading: false });
    }
  },
  setView: (view) => set({ view }),
  selectNode: (selectedNodeId) => set({ selectedNodeId, selectedFindingId: null }),
  selectFinding: (selectedFindingId) => set({ selectedFindingId }),
  toggleDirection: (d) =>
    set((s) => {
      const directions = new Set(s.filters.directions);
      directions.has(d) ? directions.delete(d) : directions.add(d);
      return { filters: { ...s.filters, directions } };
    }),
  setMinSeverity: (minSeverity) => set((s) => ({ filters: { ...s.filters, minSeverity } })),
  toggleSatisfied: () => set((s) => ({ filters: { ...s.filters, showSatisfied: !s.filters.showSatisfied } })),
  setSearch: (search) => set((s) => ({ filters: { ...s.filters, search } })),
}));

// ---- selectors (pure, testable) ----

export function visibleFindings(graph: AssessmentGraph, f: Filters): Finding[] {
  return graph.findings.filter((fd) => {
    if (!f.directions.has(fd.direction)) return false;
    if (f.minSeverity && SEV_RANK[fd.severity] < SEV_RANK[f.minSeverity]) return false;
    if (f.search) {
      const q = f.search.toLowerCase();
      if (!(`${fd.id} ${fd.claim} ${fd.category}`.toLowerCase().includes(q))) return false;
    }
    return true;
  });
}

export function findingById(graph: AssessmentGraph, id: string | null): Finding | null {
  return id ? graph.findings.find((f) => f.id === id) ?? null : null;
}
