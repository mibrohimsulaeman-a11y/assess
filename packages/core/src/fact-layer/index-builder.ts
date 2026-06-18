import type { GraphEdge, GraphNode, NodeType, OwnershipState } from "../types.js";

// INDEX phase — turn the raw scan into the deterministic fact layer: component
// nodes + structural edges. This is the "stored is just a claim" layer
// (VAC §6): everything here is a fact derived from source, carrying provenance,
// never a judgment. The assessment engine consumes it; it never trusts prose.

export interface SymbolRecord {
  id: string;
  type: NodeType;
  name: string;
  filePath: string;
  lineRange: [number, number];
  summary: string;
  complexity: "simple" | "moderate" | "complex";
  tags?: string[];
}

export interface RelationRecord {
  source: string;
  target: string;
  type: GraphEdge["type"];
  fact: string;
  lowConfidence?: boolean;
}

/** Derive an ownership state from structural facts alone (VAC §12). */
export function deriveOwnership(
  nodeId: string,
  edges: RelationRecord[],
  capabilityOwns: Set<string>,
): OwnershipState {
  const claimed = capabilityOwns.has(nodeId);
  const inbound = edges.filter((e) => e.target === nodeId);
  const owners = new Set(
    inbound.filter((e) => e.type === "owns").map((e) => e.source),
  );
  const isInfra = inbound.some((e) => e.type === "configures" || e.type === "routes");

  if (claimed && owners.size === 0) return "overclaimed"; // intent claims it, no structural owner
  if (owners.size > 1) return "shared";
  if (owners.size === 1) return "owned";
  if (isInfra) return "infrastructure";
  if (inbound.length === 0) return "unowned"; // nothing references it
  return "hidden"; // referenced but unclaimed by any capability
}

export function toGraphNode(sym: SymbolRecord): GraphNode {
  return {
    id: sym.id,
    type: sym.type,
    name: sym.name,
    filePath: sym.filePath,
    lineRange: sym.lineRange,
    summary: sym.summary,
    tags: sym.tags ?? [],
    complexity: sym.complexity,
  };
}

export function toGraphEdge(rel: RelationRecord): GraphEdge {
  return {
    id: `edge:${rel.type}:${rel.source}->${rel.target}`,
    source: rel.source,
    target: rel.target,
    type: rel.type,
    direction: "forward",
    weight: rel.lowConfidence ? 0.4 : 0.8,
    evidence: { fact: rel.fact, lowConfidence: rel.lowConfidence },
  };
}

export interface FactLayer {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function buildFactLayer(symbols: SymbolRecord[], relations: RelationRecord[]): FactLayer {
  return {
    nodes: symbols.map(toGraphNode),
    edges: relations.map(toGraphEdge),
  };
}
