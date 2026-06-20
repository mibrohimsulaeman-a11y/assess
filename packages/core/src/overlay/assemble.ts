import type {
  AssessmentGraph,
  Area,
  Binding,
  CandidateSignal,
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
        findingIds: [],
        candidateSignalIds: nodeFindings.map((f) => f.id),
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
  const candidateSignals = input.findings.map((f): CandidateSignal => ({
    ...f,
    source: "runtime_candidate",
    reviewStatus: "needs_agent_review",
    signalKind: f.direction === "baseline_to_code" ? "baseline_signal" : "deterministic_gap",
    evidenceRefs: [f.id, ...(f.targetNodeIds ?? [])],
    counterEvidenceChecked: ["typed assemble helper only; no semantic review pass has run"],
    openQuestions: ["Agent semantic review must decide whether this signal becomes a final finding."],
  }));
  const coverage = buildCoverageManifest({ nodes: componentNodes, areas, findings: input.findings });
  const summary = summarize([], candidateSignals, coverage.headlineTrust);

  return {
    version: "3.0.0",
    kind: "assessment",
    binding: input.binding,
    project: input.project,
    artifact: {
      type: "semantic_assessment",
      factLayerRole: "deterministic_evidence_substrate",
      runtimeSignalsAreFinalFindings: false,
      finalFindingsSource: "agent_review_required",
      note: "Typed assemble helper emits candidateSignals only; final findings require semantic review.",
    },
    intentModel: {
      lifecycle: input.intentNodes.length ? "confirmed" : "none",
      confirmedCapabilityCount: input.intentNodes.filter((n) => n.type === "capability").length,
      inferredCapabilityCount: 0,
      proposedCapabilityCount: 0,
      rejectedCapabilityCount: 0,
      entries: input.intentNodes.map((n) => ({ id: n.id, status: "confirmed_intent", label: n.name })),
    },
    assessmentNodes: [],
    candidateSignals,
    intents: input.intentNodes,
    nodes: componentNodes,
    edges,
    findings: [],
    areas,
    coverage,
    summary,
  };
}

function countFindings(findings: Array<Finding | CandidateSignal>) {
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
  return { bySeverity, byCategory, byDirection };
}

function summarize(finalFindings: Finding[], candidateSignals: CandidateSignal[], trust: string): AssessmentSummary {
  const finalCounts = countFindings(finalFindings);
  const candidateCounts = countFindings(candidateSignals);
  const headline =
    `semantic assessment shell: ${candidateSignals.length} runtime candidate signal(s), ` +
    `${finalFindings.length} final finding(s); agent semantic review required (headline trust: ${trust}).`;
  return {
    ...finalCounts,
    candidateBySeverity: candidateCounts.bySeverity,
    candidateByCategory: candidateCounts.byCategory,
    candidateByDirection: candidateCounts.byDirection,
    candidateSignalCount: candidateSignals.length,
    finalFindingCount: finalFindings.length,
    assessmentNodeCount: 0,
    headline,
  };
}
