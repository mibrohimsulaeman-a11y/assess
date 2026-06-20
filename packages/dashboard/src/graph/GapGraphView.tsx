import { useMemo } from "react";
import type { CSSProperties } from "react";
import ReactFlow, { Background, Controls, Panel, MarkerType, Position, Handle } from "reactflow";
import type { Edge, Node, NodeProps } from "reactflow";
import "reactflow/dist/style.css";
import type { AssessmentGraph, GapDirection, GraphNode, Severity } from "@assess/core";
import { useStore } from "../store.js";
import { SEVERITY_COLOR } from "../nodeColors.js";

// Gap map: the should-be (intent / capability / baseline) on the LEFT, the
// as-is code on the RIGHT, joined by the three gap-direction edges. Color of an
// edge = direction; thickness = severity; a node's accent = its worst severity.
// This is the view that makes assess different from a comprehension graph.
//
// Nodes are cards (custom node type) rather than solid colored boxes: a left
// accent bar carries the worst-severity color, a type tag says what kind of
// thing it is (intent / capability / baseline / file), the name is bold, and
// the severity reads as a labeled pill. White-on-color text is gone, so labels
// stay legible regardless of severity.

const DIRECTION_COLOR: Record<GapDirection, string> = {
  intent_to_code: "#7c3aed",
  code_to_intent: "#0891b2",
  baseline_to_code: "#b91c1c",
};

const SEV_RANK: Record<string, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };
const SATISFIED = new Set(["satisfied", "justified"]);
const NEUTRAL_SIDE = "#94a3b8";

function isIntentSide(id: string): boolean {
  return id.startsWith("intent:") || id.startsWith("capability:") || id === "baseline";
}

function tagFor(id: string, node?: GraphNode): string {
  if (id === "baseline") return "baseline";
  if (id.startsWith("capability:")) return "capability";
  if (id.startsWith("intent:")) return "intent";
  return node?.type ?? "code";
}

type GapNodeData = { name: string; path?: string; tag: string; severity?: Severity | null };

function GapNode({ data }: NodeProps<GapNodeData>) {
  const accent = data.severity ? SEVERITY_COLOR[data.severity] : NEUTRAL_SIDE;
  return (
    <div className="gnode" title={data.path ?? data.name}>
      <Handle type="target" position={Position.Left} style={{ opacity: 0 }} />
      <div className="gnode__accent" style={{ background: accent }} />
      <div className="gnode__body">
        <div className="gnode__top">
          <span className="gtag">{data.tag}</span>
        </div>
        <div className="gnode__name">{data.name}</div>
        {data.path ? <div className="gnode__path">{data.path}</div> : null}
        {data.severity ? (
          <div className="gnode__row">
            <span className="gpill" style={{ background: SEVERITY_COLOR[data.severity] }}>{data.severity}</span>
          </div>
        ) : null}
      </div>
      <Handle type="source" position={Position.Right} style={{ opacity: 0 }} />
    </div>
  );
}

const NODE_TYPES = { gapNode: GapNode };

export function GapGraphView({ graph }: { graph: AssessmentGraph }) {
  const { filters, selectNode, selectFinding } = useStore();

  const { nodes, edges } = useMemo(() => {
    const nodeMap = new Map<string, GraphNode>();
    for (const n of [...graph.nodes, ...graph.intents]) nodeMap.set(n.id, n);
    const findingById = new Map(graph.findings.map((f) => [f.id, f]));
    const signalById = new Map((graph.candidateSignals ?? []).map((s) => [s.id, s]));
    const q = filters.search.trim().toLowerCase();

    const gapEdges = graph.edges.filter((e) => {
      const gap = e.gap;
      if (!gap) return false;
      if (!filters.directions.has(gap.direction)) return false;
      if (!filters.showSatisfied && SATISFIED.has(gap.status)) return false;
      const fid = gap.findingId;
      const sid = gap.candidateSignalId;
      const severityItem = fid ? findingById.get(fid) : sid ? signalById.get(sid) : undefined;
      const minSeverity = filters.minSeverity;
      if (minSeverity && (!severityItem || (SEV_RANK[severityItem.severity] ?? -1) < (SEV_RANK[minSeverity] ?? 0))) return false;
      if (q) {
        const fin = fid ? findingById.get(fid) : sid ? signalById.get(sid) : undefined;
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

    const ROWH = 104;
    const RIGHT_X = 520;
    const mkNode = (id: string, x: number, y: number): Node => {
      const node = nodeMap.get(id);
      return {
        id,
        type: "gapNode",
        position: { x, y },
        data: {
          name: node?.name ?? id,
          path: node?.filePath,
          tag: tagFor(id, node),
          severity: node?.assessment?.worstSeverity ?? null,
        } as GapNodeData,
      };
    };

    const rfNodes: Node[] = [
      ...leftIds.map((id, i) => mkNode(id, 20, 20 + i * ROWH)),
      ...rightIds.map((id, i) => mkNode(id, RIGHT_X, 20 + i * ROWH)),
    ];

    const rfEdges: Edge[] = gapEdges.map((e) => {
      const gap = e.gap!;
      const fin = gap.findingId
        ? findingById.get(gap.findingId)
        : gap.candidateSignalId
          ? signalById.get(gap.candidateSignalId)
          : undefined;
      const stroke = DIRECTION_COLOR[gap.direction];
      const width = fin ? 1 + (SEV_RANK[fin.severity] ?? 0) : 1.5;
      const labelStyle: CSSProperties = { fontSize: 10, fill: stroke, fontWeight: 600 };
      const labelBgStyle: CSSProperties = { fill: "#fff", fillOpacity: 0.85 };
      const style: CSSProperties = { stroke, strokeWidth: width };
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        label: fin ? `${gap.status} · ${fin.severity}` : gap.status,
        labelStyle,
        labelBgStyle,
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        style,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke },
        animated: gap.status === "misaligned" || gap.status === "violation",
        data: { findingId: gap.findingId, candidateSignalId: gap.candidateSignalId },
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
        nodeTypes={NODE_TYPES}
        defaultViewport={{ x: 24, y: 16, zoom: 0.85 }}
        minZoom={0.2}
        onNodeClick={(_, n) => selectNode(n.id)}
        onEdgeClick={(_, ed) => {
          const fid = (ed.data as { findingId?: string; candidateSignalId?: string } | undefined)?.findingId;
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
