import type { GapDirection, Severity } from "@assess/core";
import { useStore } from "../store.js";

const DIRECTIONS: Array<{ id: GapDirection; label: string }> = [
  { id: "intent_to_code", label: "intent \u2192 code (over-promise)" },
  { id: "code_to_intent", label: "code \u2192 intent (unexplained)" },
  { id: "baseline_to_code", label: "baseline \u2192 code (defects)" },
];

const SEVERITIES: Severity[] = ["P0", "P1", "P2", "P3"];

export function FilterPanel() {
  const { filters, toggleDirection, setMinSeverity, toggleSatisfied, setSearch } = useStore();

  return (
    <section className="panel">
      <h3 className="panel__title">Filters</h3>

      <label className="panel__label">Search</label>
      <input
        className="panel__input"
        placeholder="name, path, finding\u2026"
        value={filters.search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <label className="panel__label">Gap direction</label>
      {DIRECTIONS.map((d) => (
        <label key={d.id} className="panel__check">
          <input
            type="checkbox"
            checked={filters.directions.has(d.id)}
            onChange={() => toggleDirection(d.id)}
          />
          {d.label}
        </label>
      ))}

      <label className="panel__label">Min severity</label>
      <div className="panel__sev">
        <button className={!filters.minSeverity ? "on" : ""} onClick={() => setMinSeverity(null)}>All</button>
        {SEVERITIES.map((s) => (
          <button key={s} className={filters.minSeverity === s ? "on" : ""} onClick={() => setMinSeverity(s)}>{s}</button>
        ))}
      </div>

      <label className="panel__check">
        <input type="checkbox" checked={filters.showSatisfied} onChange={toggleSatisfied} />
        Show satisfied / justified edges
      </label>
    </section>
  );
}
