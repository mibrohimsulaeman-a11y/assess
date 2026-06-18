import type {
  AssessmentGraph,
  Area,
  Binding,
  Finding,
  GraphEdge,
  GraphNode,
  ProjectMeta,
  Readiness,
  Severity,
  AssessmentSummary,
  GapDirection,
  EvidenceStrength,
} from "../types.js";
import type { AreaPartition } from "../fact-layer/scan.js";
import type { RelationRecord } from "../fact-layer/index-builder.js";
import { deriveOwnership } from "../fact-layer/index-builder.js";
import { buildCoverageManifest, areaCoverage } from "../assess/coverage.js";
import { worstSeverity } from "../assess/severity.js";

// ASSEMBLE phase — fold the fact layer, the intent model, and the engine output
// into one assessment-graph.json. The overlay step stamps each component node
// with its assessment verdict (coverage, ownership, readiness, worst severity)
// and rolls findings up to areas, so the dashboard can color by gap.

export interface AssembleInput {
  project: ProjectMeta;
  binding: Binding;
  intentNodes: GraphNode[];          // capability + intent nodes
  componentNodes: GraphNode[];       // fact-layer nodes
  factEdges: GraphEdge[];
  gapEdges: GraphEdge[];
  findings: Finding[];
  partitions: AreaPartition[];
  capabilityOwns: Set<string>;
  relationRecords: RelationRecord[];
  /** node ids that were scanned but never reached a verdict, with reason */
  notAssessed?: Map<string, string>;
}

function readinessFor(worst: Severity | null): Readiness {
  if (worst === null) return "ready";
  if (worst === "P0") return "blocked";
  if (worst === "P1") return "partial";
  return "partial";
}

export function assembleGraph(input: AssembleInput): AssessmentGraph {
  const findingsByNode = new Map<string, Finding[]>();
  for (const f of input.findings) {
    for (const nid of f.targetNodeIds) {
      if (!findingsByNode.has(nid)) findingsByNode.set(nid, []);
      findingsByNode.get(nid)!.push(f);
    }
  }

  // stamp the assessment overlay on each component node
  const componentNodes: GraphNode[] = input.componentNodes.map((node) => {
    const nodeFindings = findingsByNode.get(node.id) ?? [];
    const worst = worstSeverity(nodeFindings.map((f) => f.severity));
    const notAssessedReason = input.notAssessed?.get(node.id);
    const ownership = deriveOwnership(node.id, input.relationRecords, input.capabilityOwns);
    const trust = nodeFindings.reduce<EvidenceStrength | undefined>((acc, f) => {
      const rank = { verified: 2, inferred: 1, unverifiable: 0 } as const;
      return acc && rank[acc] <= rank[f.evidence.strength] ? acc : f.evidence.strength;
    }, undefined);
    return {
      ...node,
      assessment: {
        coverageStatus: notAssessedReason ? "not_assessed" : "assessed",
        ownership,
        findingIds: nodeFindings.map((f) => f.id),
        readiness: notAssessedReason ? "unknown" : readinessFor(worst),
        worstSeverity: worst,
        trust,
        notAssessedReason,
      },
    };
  });

  const nodeMap = new Map<string, GraphNode>(
    [...componentNodes, ...input.intentNodes].map((n) => [n.id, n]),
  );

  // roll findings up to areas
  const areas: Area[] = input.partitions.map((p) => {
    const nodeIds = componentNodes
      .filter((n) => n.filePath && p.filePaths.includes(n.filePath))
      .map((n) => n.id);
    const area: Area = {
      id: p.id,
      name: p.name,
      description: p.description,
      nodeIds,
      coverageStatus: "assessed",
    };
    area.coverageStatus = areaCoverage(area, nodeMap);
    const areaSeverities = nodeIds
      .map((id) => nodeMap.get(id)?.assessment?.worstSeverity)
      .filter((s): s is Severity => !!s);
    area.worstSeverity = worstSeverity(areaSeverities);
    return area;
  });

  const edges = [...input.factEdges, ...input.gapEdges];
  const coverage = buildCoverageManifest({ nodes: componentNodes, areas, findings: input.findings });
  const summary = summarize(input.findings, coverage.headlineTrust);

  return {
    version: "2.0.0",
    kind: "assessment",
    binding: input.binding,
    project: input.project,
    intents: input.intentNodes,
    nodes: componentNodes,
    edges,
    findings: input.findings,
    areas,
    coverage,
    summary,
  };
}

function summarize(findings: Finding[], trust: string): AssessmentSummary {
  const bySeverity: Record<Severity, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byCategory: Record<string, number> = {};
  const byDirection: Record<GapDirection, number> = {
    intent_to_code: 0, code_to_intent: 0, baseline_to_code: 0,
  };
  for (const f of findings) {
    bySeverity[f.severity]++;
    byCategory[f.category] = (byCategory[f.category] ?? 0) + 1;
    byDirection[f.direction]++;
  }
  const headline =
    `${bySeverity.P0} P0 / ${bySeverity.P1} P1 across ` +
    `${byDirection.intent_to_code} intent→code, ${byDirection.code_to_intent} code→intent, ` +
    `${byDirection.baseline_to_code} baseline findings (headline trust: ${trust}).`;
  return { bySeverity, byCategory, byDirection, headline };
}
