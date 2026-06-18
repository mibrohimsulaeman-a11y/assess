import type {
  Area,
  AssessmentGraph,
  CoverageManifest,
  CoverageStatus,
  EvidenceStrength,
  GraphNode,
} from "../types.js";
import { headlineTrust } from "./severity.js";

// Coverage manifest. THE differentiator from a comprehension graph: every area
// that was scanned must carry an explicit assessment status, and anything not
// fully assessed is surfaced — never silently dropped. The goal is whole-repo
// coverage; this module proves how close the run got and names every gap.

const EMPTY_BY_STATUS: Record<CoverageStatus, number> = {
  assessed: 0,
  partial: 0,
  not_assessed: 0,
  coverage_insufficient: 0,
};

/** Roll a node's coverage status up from its assessment overlay. */
export function nodeCoverage(node: GraphNode): CoverageStatus {
  return node.assessment?.coverageStatus ?? "not_assessed";
}

/** Compute an area's coverage as the weakest status among its assessable nodes. */
export function areaCoverage(area: Area, nodes: Map<string, GraphNode>): CoverageStatus {
  const order: CoverageStatus[] = [
    "assessed", "partial", "coverage_insufficient", "not_assessed",
  ];
  let worst: CoverageStatus = "assessed";
  let counted = 0;
  for (const id of area.nodeIds) {
    const node = nodes.get(id);
    if (!node || node.type === "intent" || node.type === "capability") continue;
    counted++;
    const status = nodeCoverage(node);
    if (order.indexOf(status) > order.indexOf(worst)) worst = status;
  }
  return counted === 0 ? "not_assessed" : worst;
}

export function buildCoverageManifest(
  graph: Pick<AssessmentGraph, "nodes" | "areas" | "findings">,
): CoverageManifest {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const byStatus: Record<CoverageStatus, number> = { ...EMPTY_BY_STATUS };

  const assessable = graph.nodes.filter(
    (n) => n.type !== "intent" && n.type !== "capability",
  );
  for (const node of assessable) {
    byStatus[nodeCoverage(node)]++;
  }

  const gaps: CoverageManifest["gaps"] = [];
  // every area that is not fully assessed becomes an explicit, named gap
  for (const area of graph.areas) {
    const status = areaCoverage(area, nodeMap);
    if (status !== "assessed") {
      gaps.push({
        scope: area.name,
        status,
        reason:
          status === "not_assessed"
            ? "no node in this area received an assessment verdict"
            : status === "coverage_insufficient"
              ? "index coverage too low to assess this area"
              : "some nodes in this area are only partially assessed",
      });
    }
  }
  // individual not_assessed / coverage_insufficient nodes outside flagged areas
  for (const node of assessable) {
    const status = nodeCoverage(node);
    if (status === "not_assessed" || status === "coverage_insufficient") {
      const reason = node.assessment?.notAssessedReason;
      if (reason) gaps.push({ scope: node.name, status, reason });
    }
  }

  const trust: EvidenceStrength = headlineTrust(graph.findings);

  return {
    totalAreas: graph.areas.length,
    totalNodes: assessable.length,
    byStatus,
    headlineTrust: trust,
    gaps,
  };
}

/** True when every assessable node reached `assessed` — the ideal whole-repo run. */
export function isFullyCovered(manifest: CoverageManifest): boolean {
  return (
    manifest.byStatus.not_assessed === 0 &&
    manifest.byStatus.coverage_insufficient === 0 &&
    manifest.byStatus.partial === 0
  );
}
