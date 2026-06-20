import type { AssessmentGraph, CandidateSignal, Finding } from "../types.js";

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
  const filePaths = new Set(graph.nodes.map((n) => n.filePath).filter((p): p is string => !!p));
  const findingIds = new Set(graph.findings.map((f) => f.id));
  const candidateSignalIds = new Set(graph.candidateSignals.map((s) => s.id));
  const assessmentNodeFindingIds = new Set<string>();
  for (const n of graph.assessmentNodes) for (const id of n.findingIds) assessmentNodeFindingIds.add(id);
  const reviewComplete = graph.artifact.finalFindingsSource === "agent_review" || graph.artifact.finalFindingsSource === "human_review";
  const knownEndpoint = (id: string) =>
    nodeIds.has(id) || id === "baseline" || id === "intent:UNCONFIRMED";
  const knownEvidenceRef = (ref: string) => {
    if (!ref) return false;
    if (knownEndpoint(ref) || findingIds.has(ref) || candidateSignalIds.has(ref)) return true;
    if (ref.startsWith("candidate:")) return candidateSignalIds.has(ref.slice("candidate:".length));
    if (ref.startsWith("finding:")) return findingIds.has(ref.slice("finding:".length));
    if (ref.startsWith("file:")) {
      const body = ref.slice("file:".length);
      for (const filePath of filePaths) if (body === filePath || body.startsWith(`${filePath}:`)) return true;
      return false;
    }
    return false;
  };

  if (graph.version !== "3.0.0") {
    issues.push({ level: "error", code: "GRAPH_VERSION", message: `version must be 3.0.0, got ${graph.version}` });
  }
  if (graph.artifact.runtimeSignalsAreFinalFindings !== false) {
    issues.push({ level: "error", code: "ARTIFACT_SIGNAL_GATE", message: "artifact.runtimeSignalsAreFinalFindings must be false" });
  }

  // referential integrity
  for (const e of graph.edges) {
    if (!knownEndpoint(e.source)) issues.push({ level: "error", code: "EDGE_SOURCE", message: `edge ${e.id} source ${e.source} not found` });
    if (!knownEndpoint(e.target)) issues.push({ level: "error", code: "EDGE_TARGET", message: `edge ${e.id} target ${e.target} not found` });
    if (e.gap?.findingId && !findingIds.has(e.gap.findingId) && !candidateSignalIds.has(e.gap.findingId)) {
      issues.push({ level: "error", code: "EDGE_FINDING", message: `edge ${e.id} references unknown finding or candidate signal ${e.gap.findingId}` });
    }
    if (e.gap?.candidateSignalId && !candidateSignalIds.has(e.gap.candidateSignalId)) {
      issues.push({ level: "error", code: "EDGE_CANDIDATE_SIGNAL", message: `edge ${e.id} references unknown candidate signal ${e.gap.candidateSignalId}` });
    }
  }

  // finding / candidate target integrity
  if (graph.artifact.finalFindingsSource === "agent_review_required" && graph.findings.length > 0) {
    issues.push({ level: "error", code: "FINAL_FINDING_WITHOUT_REVIEW", message: "final findings present while artifact.finalFindingsSource is agent_review_required" });
  }
  if (reviewComplete) {
    if (graph.assessmentNodes.length === 0) {
      issues.push({ level: "error", code: "REVIEWED_WITHOUT_SEMANTIC_NODES", message: "reviewed artifact requires at least one assessmentNode" });
    }
    for (const s of graph.candidateSignals) {
      if (s.reviewStatus === "needs_agent_review") {
        issues.push({ level: "error", code: "REVIEWED_PENDING_CANDIDATE", message: `candidate signal ${s.id} cannot remain needs_agent_review in a reviewed artifact` });
      }
    }
    for (const f of graph.findings) {
      if (!assessmentNodeFindingIds.has(f.id)) {
        issues.push({ level: "error", code: "FINAL_FINDING_UNLINKED", message: `finding ${f.id} must be referenced by at least one assessmentNode` });
      }
    }
  }
  for (const f of graph.findings) {
    for (const t of f.targetNodeIds) {
      if (!nodeIds.has(t) && t !== "intent:UNCONFIRMED") {
        issues.push({ level: "error", code: "FINDING_TARGET", message: `finding ${f.id} target ${t} not found` });
      }
    }
    if (f.source !== "agent_review" && f.source !== "human_review") {
      issues.push({ level: "error", code: "FINAL_FINDING_SOURCE", message: `finding ${f.id} must declare source agent_review or human_review` });
    }
    if (!f.reasoningSummary || !f.evidenceRefs?.length) {
      issues.push({ level: "error", code: "FINAL_FINDING_REASONING", message: `finding ${f.id} requires reasoningSummary and evidenceRefs` });
    }
    for (const ref of f.evidenceRefs ?? []) {
      if (!knownEvidenceRef(ref)) issues.push({ level: "error", code: "FINAL_FINDING_EVIDENCE_REF", message: `finding ${f.id} evidenceRef ${ref} not found` });
    }
    issues.push(...honestyChecks(f));
  }
  for (const s of graph.candidateSignals) {
    for (const t of s.targetNodeIds) {
      if (!nodeIds.has(t) && t !== "intent:UNCONFIRMED") {
        issues.push({ level: "error", code: "CANDIDATE_TARGET", message: `candidate signal ${s.id} target ${t} not found` });
      }
    }
    if (graph.artifact.finalFindingsSource === "agent_review_required") {
      if (s.reviewStatus !== "needs_agent_review") {
        issues.push({ level: "error", code: "CANDIDATE_REVIEW_STATUS", message: `candidate signal ${s.id} must remain needs_agent_review when finalFindingsSource is agent_review_required` });
      }
      if (s.promotedFindingId) {
        issues.push({ level: "error", code: "CANDIDATE_PROMOTED_RUNTIME", message: `candidate signal ${s.id} cannot have promotedFindingId when finalFindingsSource is agent_review_required` });
      }
    }
    if (s.reviewStatus === "accepted" && !s.promotedFindingId) {
      issues.push({ level: "error", code: "CANDIDATE_ACCEPTED_WITHOUT_PROMOTION", message: `candidate signal ${s.id} accepted status requires promotedFindingId` });
    }
    if (s.promotedFindingId && !findingIds.has(s.promotedFindingId)) {
      issues.push({ level: "error", code: "CANDIDATE_PROMOTED_FINDING", message: `candidate signal ${s.id} promotedFindingId ${s.promotedFindingId} not found` });
    }
    for (const ref of s.evidenceRefs) {
      if (!knownEvidenceRef(ref)) issues.push({ level: "error", code: "CANDIDATE_EVIDENCE_REF", message: `candidate signal ${s.id} evidenceRef ${ref} not found` });
    }
    issues.push(...honestyChecks(s));
  }
  for (const n of graph.assessmentNodes) {
    for (const id of n.candidateSignalIds) {
      if (!candidateSignalIds.has(id)) issues.push({ level: "error", code: "ASSESSMENT_NODE_SIGNAL", message: `assessmentNode ${n.id} candidate signal ${id} not found` });
    }
    for (const id of n.findingIds) {
      if (!findingIds.has(id)) issues.push({ level: "error", code: "ASSESSMENT_NODE_FINDING", message: `assessmentNode ${n.id} finding ${id} not found` });
    }
    for (const ref of n.evidenceRefs) {
      if (!knownEvidenceRef(ref)) issues.push({ level: "error", code: "ASSESSMENT_NODE_EVIDENCE_REF", message: `assessmentNode ${n.id} evidenceRef ${ref} not found` });
    }
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

function honestyChecks(f: Finding | CandidateSignal): ValidationIssue[] {
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
