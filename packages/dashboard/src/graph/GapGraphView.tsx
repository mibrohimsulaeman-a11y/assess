import { useMemo } from "react";
import type { CSSProperties } from "react";
import ReactFlow, { Background, Controls, Panel, MarkerType, Position } from "reactflow";
import type { Edge, Node } from "reactflow";
import "reactflow/dist/style.css";
import type { AssessmentGraph, GapDirection, GraphNode } from "@assess/core";
import { useStore, visibleFindings } from "../store.js";
import { SEVERITY_COLOR } from "../nodeColors.js";

// Gap map: the should-be (intent / capability / baseline) on the LEFT, the
// as-is code on the RIGHT, joined by the three gap-direction edges. Color of an
// edge = direction; thickness = severity; a node's fill = its worst severity.
// This is the view that makes assess different from a comprehension graph.

const DIRECTION_COLOR: Record<GapDirection, string> = {
  intent_to_code: "#7c3aed",
  code_to_intent: "#0891b2",
  baseline_to_code: "#b91c1c",
};

const SEV_RANK: Record<string, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };
const SATISFIED = new Set(["satisfied", "justified"]);

function isIntentSide(id: string): boolean {
  return id.startsWith("intent:") || id.startsWith("capability:") || id === "baseline";
}

export function GapGraphView({ graph }: { graph: AssessmentGraph }) {
  const { filters, selectNode, selectFinding } = useStore();

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    for (const n of [...graph.nodes, ...graph.intents]) nodeMap.set(n.id, n);
    const findingById = new Map(graph.findings.map((f) => [f.id, f]));
    const passesSeverity = new Set(visibleFindings(graph, filters).map((f) => f.id));
    const q = filters.search.trim().toLowerCase();

    const gapEdges = graph.edges.filter((e) => {
      const gap = e.gap;
      if (!gap) return false;
      if (!filters.directions.has(gap.direction)) return false;
      if (!filters.showSatisfied && SATISFIED.has(gap.status)) return false;
      const fid = gap.findingId;
      if (filters.minSeverity && (!fid || !passesSeverity.has(fid))) return false;
      if (q) {
        const fin = fid ? findingById.get(fid) : undefined;
        const hay = `${e.source} ${e.target} ${gap.status} ${fin?.claim ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const leftIds: string[] = [];
    const rightIds: string[] = [];
    const seen = new Set<string>();
    const place = (id: string) => {
      if (seen.has(id)) return;
      seen.add(id);
      (isIntentSide(id) ? leftIds : rightIds).push(id);
    };
    for (const e of gapEdges) {
      place(e.source);
      place(e.target);
    }

    const labelFor = (id: string): string => nodeMap.get(id)?.name ?? id;
    const nodeColor = (id: string): string => {
      const sev = nodeMap.get(id)?.assessment?.worstSeverity;
      if (sev) return SEVERITY_COLOR[sev];
      return isIntentSide(id) ? "#475569" : "#15803d";
    };

    const mkNode = (id: string, x: number, y: number): Node => {
      const style: CSSProperties = {
        background: nodeColor(id),
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 12,
        width: 190,
      };
      return {
        id,
        position: { x, y },
        data: { label: labelFor(id) },
        style,
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
      };
    };

    const rfNodes: Node[] = [
      ...leftIds.map((id, i) => mkNode(id, 20, 20 + i * 84)),
      ...rightIds.map((id, i) => mkNode(id, 470, 20 + i * 84)),
    ];

    const rfEdges: Edge[] = gapEdges.map((e) => {
      const gap = e.gap!;
      const fin = gap.findingId ? findingById.get(gap.findingId) : undefined;
      const stroke = DIRECTION_COLOR[gap.direction];
      const width = fin ? 1 + (SEV_RANK[fin.severity] ?? 0) : 1.5;
      const labelStyle: CSSProperties = { fontSize: 10, fill: stroke };
      const style: CSSProperties = { stroke, strokeWidth: width };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: fin ? `${gap.status} \u00b7 ${fin.severity}` : gap.status,
        labelStyle,
        style,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        animated: gap.status === "misaligned" || gap.status === "violation",
        data: { findingId: gap.findingId },
      };
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, filters]);

  const wrapStyle: CSSProperties = { width: "100%", height: "100%" };
  const legendStyle: CSSProperties = {
    display: "flex",
    gap: 12,
    background: "#fff",
    padding: "6px 10px",
    borderRadius: 8,
    fontSize: 11,
    boxShadow: "0 1px 4px rgba(0,0,0,0.15)",
  };
  const directions: GapDirection[] = ["intent_to_code", "code_to_intent", "baseline_to_code"];

  return (
    <div style={wrapStyle}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        onNodeClick={(_, n) => selectNode(n.id)}
        onEdgeClick={(_, ed) => {
          const fid = (ed.data as { findingId?: string } | undefined)?.findingId;
          if (fid) selectFinding(fid);
        }}
      >
        <Background />
        <Controls />
        <Panel position="top-right">
          <div style={legendStyle}>
            {directions.map((d) => {
              const item: CSSProperties = { display: "flex", alignItems: "center", gap: 4 };
              const dot: CSSProperties = {
                width: 10,
                height: 10,
                borderRadius: 2,
                background: DIRECTION_COLOR[d],
                display: "inline-block",
              };
              return (
                <span key={d} style={item}>
                  <span style={dot} />
                  {d.replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
