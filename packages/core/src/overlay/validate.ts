import type { AssessmentGraph, Finding } from "../types.js";

// Structural + honesty validation, run before the graph is written. Beyond Zod
// (shape), these are the INVARIANTS that make the graph trustworthy:
//   - referential integrity (every edge endpoint and findingId resolves)
//   - coverage completeness (every assessable node has a status)
//   - honesty rules (missing finding => proof; severity respects evidence caps)

export interface ValidationIssue {
  level: "error" | "warn";
  code: string;
  message: string;
}

export function validateAssessmentGraph(graph: AssessmentGraph): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const nodeIds = new Set([...graph.nodes, ...graph.intents].map((n) => n.id));
  const findingIds = new Set(graph.findings.map((f) => f.id));

  // referential integrity
  for (const e of graph.edges) {
    const knownEndpoint = (id: string) =>
      nodeIds.has(id) || id === "baseline" || id === "intent:UNCONFIRMED";
    if (!knownEndpoint(e.source)) issues.push({ level: "error", code: "EDGE_SOURCE", message: `edge ${e.id} source ${e.source} not found` });
    if (!knownEndpoint(e.target)) issues.push({ level: "error", code: "EDGE_TARGET", message: `edge ${e.id} target ${e.target} not found` });
    if (e.gap?.findingId && !findingIds.has(e.gap.findingId)) {
      issues.push({ level: "error", code: "EDGE_FINDING", message: `edge ${e.id} references unknown finding ${e.gap.findingId}` });
    }
  }

  // finding target integrity
  for (const f of graph.findings) {
    for (const t of f.targetNodeIds) {
      if (!nodeIds.has(t) && t !== "intent:UNCONFIRMED") {
        issues.push({ level: "error", code: "FINDING_TARGET", message: `finding ${f.id} target ${t} not found` });
      }
    }
    issues.push(...honestyChecks(f));
  }

  // coverage completeness: every assessable node must carry a status
  for (const n of graph.nodes) {
    if (n.type === "intent" || n.type === "capability") continue;
    if (!n.assessment) {
      issues.push({ level: "error", code: "NO_COVERAGE", message: `node ${n.id} has no assessment overlay` });
    }
  }

  // coverage manifest must account for every assessable node
  const counted =
    graph.coverage.byStatus.assessed +
    graph.coverage.byStatus.partial +
    graph.coverage.byStatus.not_assessed +
    graph.coverage.byStatus.coverage_insufficient;
  const assessable = graph.nodes.filter((n) => n.type !== "intent" && n.type !== "capability").length;
  if (counted !== assessable) {
    issues.push({ level: "error", code: "COVERAGE_MISMATCH", message: `coverage manifest counts ${counted} but there are ${assessable} assessable nodes` });
  }
  if ((graph.coverage.byStatus.not_assessed > 0 || graph.coverage.byStatus.coverage_insufficient > 0) && graph.coverage.gaps.length === 0) {
    issues.push({ level: "error", code: "COVERAGE_GAPS_MISSING", message: "coverage manifest has not_assessed/coverage_insufficient nodes but no coverage gaps" });
  }

  return issues;
}

function honestyChecks(f: Finding): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  // missing / dead-code claims require a missing-code proof
  const claimsAbsence =
    f.category === "alignment.missing" ||
    f.category === "alignment.unexplained" ||
    /no (implementing|code|path)|dead code|never called/i.test(f.claim);
  if (claimsAbsence && !f.missingCodeProof) {
    out.push({ level: "error", code: "NO_ABSENCE_PROOF", message: `finding ${f.id} claims absence without a missing-code proof` });
  }
  if (claimsAbsence && f.missingCodeProof && f.missingCodeProof.result !== "absent" && (f.severity === "P0" || f.severity === "P1")) {
    out.push({ level: "error", code: "UNPROVEN_ABSENCE_HIGH", message: `finding ${f.id} is ${f.severity} but absence is only ${f.missingCodeProof.result}` });
  }
  // evidence/severity honesty caps
  if (f.evidence.strength === "unverifiable" && (f.severity === "P0" || f.severity === "P1")) {
    out.push({ level: "error", code: "OVERCLAIM", message: `finding ${f.id} is ${f.severity} on unverifiable evidence (cap P2)` });
  }
  if (f.intentRef === "UNCONFIRMED" && f.severity === "P0") {
    out.push({ level: "error", code: "UNCONFIRMED_P0", message: `finding ${f.id} is P0 against UNCONFIRMED intent (cap P2)` });
  }
  return out;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.level === "error");
}
