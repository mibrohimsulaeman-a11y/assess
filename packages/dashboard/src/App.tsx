import { useEffect } from "react";
import { useStore, type ViewMode } from "./store.js";
import { CoverageBanner } from "./components/CoverageBanner.js";
import { FilterPanel } from "./components/FilterPanel.js";
import { NodeInfo } from "./components/NodeInfo.js";
import { RunSummary } from "./components/RunSummary.js";
import { GapGraphView } from "./graph/GapGraphView.js";
import { CoverageMapView } from "./graph/CoverageMapView.js";
import { FindingsView } from "./graph/FindingsView.js";

const TABS: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: "coverage", label: "Coverage map", hint: "What was assessed, and what was not" },
  { id: "gap", label: "Gap map", hint: "intent to code, code to intent, and baseline gaps" },
  { id: "findings", label: "Findings", hint: "Ranked verdicts with evidence" },
];

export function App() {
  const { graph, loading, error, view, setView, load } = useStore();

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <strong>assess</strong>
          <span className="app__subtitle">post-run gap dashboard, not a comprehension tour</span>
        </div>
        <nav className="app__tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${view === t.id ? "tab--active" : ""}`}
              onClick={() => setView(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {loading && <div className="app__state">Loading assessment-graph.json...</div>}
      {error && <div className="app__state app__state--error">Failed to load: {error}</div>}

      {graph && (
        <>
          <RunSummary graph={graph} />
          <CoverageBanner graph={graph} />
          <div className="app__body">
            <aside className="app__sidebar">
              <FilterPanel />
              <NodeInfo />
            </aside>
            <main className="app__canvas">
              {view === "coverage" && <CoverageMapView graph={graph} />}
              {view === "gap" && <GapGraphView graph={graph} />}
              {view === "findings" && <FindingsView graph={graph} />}
            </main>
          </div>
        </>
      )}
    </div>
  );
}
