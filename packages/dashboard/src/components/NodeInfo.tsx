import type { CSSProperties } from "react";
import { useStore } from "../store.js";
import { COVERAGE_COLOR, OWNERSHIP_COLOR, severityColor } from "../nodeColors.js";

// Detail panel for the selected node: its assessment verdict, ownership state,
// and the findings attached to it. Bridges the graph and the findings list.

const badge = (background: string): CSSProperties => ({
  background,
  color: "#fff",
  borderRadius: 6,
  padding: "2px 8px",
  fontSize: 11,
  marginRight: 6,
});

export function NodeInfo() {
  const { graph, selectedNodeId } = useStore();
  if (!graph || !selectedNodeId) {
    return <section className="panel panel--muted">Select a node to see its assessment.</section>;
  }
  const node = [...graph.nodes, ...graph.intents].find((n) => n.id === selectedNodeId);
  if (!node) return <section className="panel panel--muted">Node not found.</section>;

  const a = node.assessment;
  const findings = a ? graph.findings.filter((f) => a.findingIds.includes(f.id)) : [];

  return (
    <section className="panel">
      <h3 className="panel__title">{node.name}</h3>
      <p className="node__meta">
        <code>{node.type}</code>
        {node.filePath ? ` \u00b7 ${node.filePath}` : ""}
      </p>
      <p className="node__summary">{node.summary}</p>

      {node.intentMeta && (
        <p className="node__intent">
          intent: <strong>{node.intentMeta.status}</strong>
          {node.intentMeta.invariant ? ` \u2014 ${node.intentMeta.invariant}` : ""}
        </p>
      )}

      {a && (
        <div className="node__badges">
          <span style={badge(COVERAGE_COLOR[a.coverageStatus])}>{a.coverageStatus}</span>
          <span style={badge(OWNERSHIP_COLOR[a.ownership])}>{a.ownership}</span>
          <span style={badge(severityColor(a.worstSeverity))}>
            {a.worstSeverity ?? "no findings"}
          </span>
          <span className="node__readiness">{a.readiness}</span>
        </div>
      )}

      {a?.notAssessedReason && (
        <p className="node__warn">Not assessed: {a.notAssessedReason}</p>
      )}

      {findings.length > 0 && (
        <ul className="node__findings">
          {findings.map((f) => (
            <li key={f.id}>
              <strong>{f.severity}</strong> {f.id} {"\u2014"} {f.claim}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
