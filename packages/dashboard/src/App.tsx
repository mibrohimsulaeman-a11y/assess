import { useEffect, useState } from "react";
import { useStore, type ViewMode } from "./store.js";
import { CoverageBanner } from "./components/CoverageBanner.js";
import { FilterPanel } from "./components/FilterPanel.js";
import { NodeInfo } from "./components/NodeInfo.js";
import { RunSummary } from "./components/RunSummary.js";
import { GapGraphView } from "./graph/GapGraphView.js";
import { CoverageMapView } from "./graph/CoverageMapView.js";
import { FindingsView } from "./graph/FindingsView.js";
import { SemanticGraphView } from "./graph/SemanticGraphView.js";

const TABS: Array<{ id: ViewMode; label: string; hint: string }> = [
  { id: "semantic", label: "Semantic assessment", hint: "Curated agent/human layer; runtime signals are not final findings" },
  { id: "findings", label: "Final findings", hint: "Agent/human-reviewed verdicts only" },
  { id: "gap", label: "Fact gap signals", hint: "Runtime candidate signals and deterministic gap edges" },
  { id: "coverage", label: "Fact coverage", hint: "What the deterministic layer scanned, and what it did not" },
];

export function App() {
  const { graph, loading, error, view, setView, load } = useStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__title">
          <strong>assess</strong>
          <span className="app__subtitle">semantic assessment cockpit; deterministic facts are evidence only</span>
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
        <div className="app__body">
          <aside className={`app__sidebar ${sidebarOpen ? "" : "app__sidebar--collapsed"}`}>
            <button
              className="app__sidebar-toggle"
              onClick={() => setSidebarOpen((open) => !open)}
              title={sidebarOpen ? "Collapse run context" : "Open run context"}
            >
              {sidebarOpen ? "‹" : "›"}
            </button>
            {sidebarOpen && (
              <div className="app__sidebar-content">
                <RunSummary graph={graph} />
                <CoverageBanner graph={graph} />
                <FilterPanel />
                <NodeInfo />
              </div>
            )}
          </aside>
          <main className="app__canvas">
            {view === "semantic" && <SemanticGraphView graph={graph} />}
            {view === "coverage" && <CoverageMapView graph={graph} />}
            {view === "gap" && <GapGraphView graph={graph} />}
            {view === "findings" && <FindingsView graph={graph} />}
          </main>
        </div>
      )}
    </div>
  );
}
