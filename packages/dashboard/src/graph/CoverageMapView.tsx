import { useMemo } from "react";
import type { CSSProperties } from "react";
import ReactFlow, { Background, Controls, Panel } from "reactflow";
import type { Edge, Node } from "reactflow";
import "reactflow/dist/style.css";
import type { AssessmentGraph, CoverageStatus, GraphNode } from "@assess/core";
import { useStore } from "../store.js";
import { COVERAGE_COLOR } from "../nodeColors.js";

// Coverage map: every area + every scanned node, colored by assessment status.
// not_assessed is loud red ON PURPOSE — the point of this view is to make the
// holes in coverage impossible to miss, not to imply everything was checked.

export function CoverageMapView({ graph }: { graph: AssessmentGraph }) {
  const { filters, selectNode } = useStore();
  const q = filters.search.trim().toLowerCase();

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];
    const COLW = 250;

    graph.areas.forEach((area, ai) => {
      const x = 20 + ai * COLW;
      const headId = `__area__${area.id}`;
      const headStyle: CSSProperties = {
        background: COVERAGE_COLOR[area.coverageStatus],
        color: "#fff",
        border: "none",
        borderRadius: 8,
        padding: "6px 10px",
        fontWeight: 600,
        width: 200,
        fontSize: 12,
      };
      rfNodes.push({
        id: headId,
        position: { x, y: 10 },
        data: { label: `${area.name} \u00b7 ${area.coverageStatus}` },
        style: headStyle,
        draggable: false,
        selectable: false,
      });

      area.nodeIds.forEach((nid, ni) => {
        const n = nodeMap.get(nid);
        if (!n) return;
        if (q && !`${n.name} ${nid}`.toLowerCase().includes(q)) return;
        const status = (n.assessment?.coverageStatus ?? "not_assessed") as CoverageStatus;
        const bg = COVERAGE_COLOR[status];
        const style: CSSProperties = {
          background: "#fff",
          color: "#0f172a",
          border: `2px solid ${bg}`,
          borderRadius: 8,
          padding: "6px 10px",
          width: 190,
          fontSize: 11,
        };
        rfNodes.push({
          id: nid,
          position: { x: x + 6, y: 78 + ni * 66 },
          data: { label: `${n.name}\n${status}` },
          style,
        });
        const edgeStyle: CSSProperties = { stroke: bg, strokeWidth: 1 };
        rfEdges.push({ id: `cov:${headId}:${nid}`, source: headId, target: nid, style: edgeStyle });
      });
    });

    return { nodes: rfNodes, edges: rfEdges };
  }, [graph, q]);

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
  const statuses = Object.keys(COVERAGE_COLOR) as CoverageStatus[];

  return (
    <div style={wrapStyle}>
      <ReactFlow nodes={nodes} edges={edges} fitView onNodeClick={(_, n) => selectNode(n.id)}>
        <Background />
        <Controls />
        <Panel position="top-right">
          <div style={legendStyle}>
            {statuses.map((s) => {
              const item: CSSProperties = { display: "flex", alignItems: "center", gap: 4 };
              const dot: CSSProperties = {
                width: 10,
                height: 10,
                borderRadius: 2,
                background: COVERAGE_COLOR[s],
                display: "inline-block",
              };
              return (
                <span key={s} style={item}>
                  <span style={dot} />
                  {s.replace(/_/g, " ")}
                </span>
              );
            })}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
