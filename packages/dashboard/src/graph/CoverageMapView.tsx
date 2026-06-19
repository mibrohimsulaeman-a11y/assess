import { useMemo } from "react";
import type { CSSProperties } from "react";
import ReactFlow, { Background, Controls, Panel, Handle, Position } from "reactflow";
import type { Edge, Node, NodeProps } from "reactflow";
import "reactflow/dist/style.css";
import type { AssessmentGraph, CoverageStatus, GraphNode, Severity } from "@assess/core";
import { useStore } from "../store.js";
import { COVERAGE_COLOR, SEVERITY_COLOR } from "../nodeColors.js";

// Coverage map: every area + every scanned node, colored by assessment status.
// not_assessed is loud red ON PURPOSE — the point of this view is to make the
// holes in coverage impossible to miss, not to imply everything was checked.
//
// Nodes are rendered as cards (custom node types) instead of raw ReactFlow
// boxes: a left accent bar carries the status color, the name is bold, the
// file path is muted, and the status reads as a labeled pill. This makes the
// column scannable at a glance rather than a wall of same-size colored boxes.

const STATUS_LABEL: Record<CoverageStatus, string> = {
  assessed: "assessed",
  partial: "partial",
  coverage_insufficient: "insufficient coverage",
  not_assessed: "not assessed",
};

type AreaData = { name: string; status: CoverageStatus; count: number };
type CoverageData = { name: string; path?: string; status: CoverageStatus; severity?: Severity | null };

function AreaNode({ data }: NodeProps<AreaData>) {
  const color = COVERAGE_COLOR[data.status];
  return (
    <div className="gnode gnode--area" title={`${data.name} · ${STATUS_LABEL[data.status]}`}>
      <div className="gnode__accent" style={{ background: color }} />
      <div className="gnode__body">
        <div className="gnode__top">
          <span className="gtag">area</span>
          <span className="gnode__count">{data.count} file{data.count === 1 ? "" : "s"}</span>
        </div>
        <div className="gnode__name">{data.name}</div>
        <div className="gnode__row">
          <span className="gpill" style={{ background: color }}>{STATUS_LABEL[data.status]}</span>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

function CoverageNode({ data }: NodeProps<CoverageData>) {
  const color = COVERAGE_COLOR[data.status];
  return (
    <div className="gnode" title={`${data.path ?? data.name} · ${STATUS_LABEL[data.status]}`}>
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="gnode__accent" style={{ background: color }} />
      <div className="gnode__body">
        <div className="gnode__name">{data.name}</div>
        {data.path ? <div className="gnode__path">{data.path}</div> : null}
        <div className="gnode__row">
          <span className="gpill" style={{ background: color }}>{STATUS_LABEL[data.status]}</span>
          {data.severity ? (
            <span className="gpill" style={{ background: SEVERITY_COLOR[data.severity] }}>{data.severity}</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

const NODE_TYPES = { areaNode: AreaNode, coverageNode: CoverageNode };

export function CoverageMapView({ graph }: { graph: AssessmentGraph }) {
  const { filters, selectNode } = useStore();
  const q = filters.search.trim().toLowerCase();

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]));
    const rfNodes: Node[] = [];
    const rfEdges: Edge[] = [];
    const COLW = 300;
    const ROWH = 92;

    graph.areas.forEach((area, ai) => {
      const x = 20 + ai * COLW;
      const headId = `__area__${area.id}`;

      // resolve the visible children first so the count matches what renders
      const children = area.nodeIds
        .map((nid) => ({ nid, n: nodeMap.get(nid) }))
        .filter((c): c is { nid: string; n: GraphNode } => {
          if (!c.n) return false;
          if (q && !`${c.n.name} ${c.nid}`.toLowerCase().includes(q)) return false;
          return true;
        });

      rfNodes.push({
        id: headId,
        type: "areaNode",
        position: { x, y: 10 },
        data: { name: area.name, status: area.coverageStatus, count: children.length } as AreaData,
        draggable: false,
        selectable: false,
      });

      children.forEach(({ nid, n }, ni) => {
        const status = (n.assessment?.coverageStatus ?? "not_assessed") as CoverageStatus;
        rfNodes.push({
          id: nid,
          type: "coverageNode",
          position: { x, y: 104 + ni * ROWH },
          data: {
            name: n.name,
            path: n.filePath,
            status,
            severity: n.assessment?.worstSeverity ?? null,
          } as CoverageData,
        });
        const edgeStyle: CSSProperties = { stroke: COVERAGE_COLOR[status], strokeWidth: 1.5 };
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
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        defaultViewport={{ x: 24, y: 16, zoom: 0.85 }}
        minZoom={0.2}
        onNodeClick={(_, n) => selectNode(n.id)}
      >
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
                  {STATUS_LABEL[s]}
                </span>
              );
            })}
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
