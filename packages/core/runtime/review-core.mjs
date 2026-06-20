// =====================================================================
// Review decision workflow runtime core (zero-dependency executable boundary).
//
// This mirrors packages/core/src/review/apply-review-decisions.ts so agent/CI
// workflows can apply semantic review decisions with plain `node`, before the
// TypeScript package has been built.
// =====================================================================

const CONFIDENCE_VALUES = new Set(["HIGH", "MED", "LOW"]);
const SEMANTIC_NODE_KINDS = new Set([
  "capability",
  "workflow",
  "risk_area",
  "open_question",
  "evidence_bundle",
]);
const SEVERITY_RANK = { P3: 0, P2: 1, P1: 2, P0: 3 };
const STRENGTH_RANK = { unverifiable: 0, inferred: 1, verified: 2 };

export function applyReviewDecisions(runtimeGraph, decisionFile, options = {}) {
  assertDecisionFile(decisionFile);

  const finalFindingsSource = options.finalFindingsSource ?? inferReviewSource(decisionFile.reviewer);
  const requireAllCandidates = options.requireAllCandidates ?? true;
  const allowNeedsMoreEvidence = options.allowNeedsMoreEvidence ?? false;
  const graph = deepClone(runtimeGraph);

  if (graph.kind !== "assessment") throw new Error("review apply requires an assessment graph");
  if (graph.artifact?.finalFindingsSource !== "agent_review_required") {
    throw new Error(
      `review apply expects a runtime graph with artifact.finalFindingsSource=agent_review_required, got ${graph.artifact?.finalFindingsSource}`,
    );
  }
  if ((graph.findings || []).length > 0) {
    throw new Error("runtime graph must not contain final findings before review decisions are applied");
  }

  const candidateSignals = graph.candidateSignals || [];
  const candidateById = new Map(candidateSignals.map((signal) => [signal.id, signal]));
  const decisionByCandidate = new Map();
  for (const decision of decisionFile.decisions) {
    assertDecision(decision);
    if (decisionByCandidate.has(decision.candidateSignalId)) {
      throw new Error(`duplicate decision for candidate signal ${decision.candidateSignalId}`);
    }
    if (!candidateById.has(decision.candidateSignalId)) {
      throw new Error(`decision references unknown candidate signal ${decision.candidateSignalId}`);
    }
    decisionByCandidate.set(decision.candidateSignalId, decision);
  }

  if (requireAllCandidates) {
    const missing = candidateSignals
      .map((signal) => signal.id)
      .filter((id) => !decisionByCandidate.has(id));
    if (missing.length > 0) {
      throw new Error(`missing review decisions for candidate signal(s): ${missing.join(", ")}`);
    }
  }

  const existingFindingIds = new Set((graph.findings || []).map((finding) => finding.id));
  const existingAssessmentNodeIds = new Set((graph.assessmentNodes || []).map((node) => node.id));
  const promotedCandidateToFinding = new Map();
  const newFindings = [];
  const newAssessmentNodes = [];

  const orderedDecisions = [...decisionFile.decisions].sort((a, b) =>
    a.candidateSignalId.localeCompare(b.candidateSignalId),
  );

  for (const decision of orderedDecisions) {
    const candidate = candidateById.get(decision.candidateSignalId);
    if (!candidate) throw new Error(`decision references unknown candidate signal ${decision.candidateSignalId}`);
    const index = graph.candidateSignals.findIndex((signal) => signal.id === candidate.id);
    if (index < 0) throw new Error(`candidate signal ${candidate.id} disappeared during review apply`);

    if (decision.decision === "needs_more_evidence") {
      if (!allowNeedsMoreEvidence) {
        throw new Error(`candidate signal ${candidate.id}: needs_more_evidence is not allowed in strict reviewed apply`);
      }
      graph.candidateSignals[index] = {
        ...candidate,
        reviewStatus: "needs_agent_review",
        openQuestions: normalizeStringArray([
          ...(candidate.openQuestions ?? []),
          ...(decision.openQuestions ?? []),
          decision.rationale,
        ]),
      };
      continue;
    }

    const semanticNodeInput = decision.semanticNode;
    if (!semanticNodeInput) {
      throw new Error(`candidate signal ${candidate.id}: ${decision.decision} decision requires semanticNode`);
    }
    if (existingAssessmentNodeIds.has(semanticNodeInput.id)) {
      throw new Error(`duplicate assessment node id ${semanticNodeInput.id}`);
    }

    if (decision.decision === "reject") {
      if (decision.finding) {
        throw new Error(`candidate signal ${candidate.id}: reject decision must not create a finding`);
      }
      graph.candidateSignals[index] = {
        ...candidate,
        reviewStatus: "rejected",
        counterEvidenceChecked: normalizeStringArray([
          ...(candidate.counterEvidenceChecked ?? []),
          ...decision.counterEvidenceChecked,
        ]),
        openQuestions: normalizeStringArray(decision.openQuestions ?? []),
        promotedFindingId: undefined,
      };
      const semanticNode = buildSemanticNode(semanticNodeInput, decision, candidate, null, finalFindingsSource);
      existingAssessmentNodeIds.add(semanticNode.id);
      newAssessmentNodes.push(semanticNode);
      continue;
    }

    const findingInput = decision.finding;
    if (!findingInput) {
      throw new Error(`candidate signal ${candidate.id}: accept decision requires finding`);
    }
    if (existingFindingIds.has(findingInput.id)) {
      throw new Error(`duplicate finding id ${findingInput.id}`);
    }

    const finding = buildPromotedFinding(candidate, decision, findingInput, finalFindingsSource);
    existingFindingIds.add(finding.id);
    newFindings.push(finding);
    promotedCandidateToFinding.set(candidate.id, finding.id);

    graph.candidateSignals[index] = {
      ...candidate,
      reviewStatus: "accepted",
      promotedFindingId: finding.id,
      counterEvidenceChecked: finding.counterEvidenceChecked ?? [],
      openQuestions: finding.openQuestions ?? [],
    };

    const semanticNode = buildSemanticNode(semanticNodeInput, decision, candidate, finding, finalFindingsSource);
    existingAssessmentNodeIds.add(semanticNode.id);
    newAssessmentNodes.push(semanticNode);
  }

  graph.findings = sortById([...(graph.findings || []), ...newFindings]);
  graph.assessmentNodes = sortById([...(graph.assessmentNodes || []), ...newAssessmentNodes]);
  graph.candidateSignals = sortById(graph.candidateSignals || []);
  graph.artifact = {
    ...graph.artifact,
    finalFindingsSource,
    note: `Review decisions applied from ${decisionFile.reviewer} at ${decisionFile.reviewedAt}. Runtime candidate signals are preserved with accepted/rejected status; final findings are review-derived only.`,
  };

  updateGapEdges(graph, promotedCandidateToFinding);
  recomputeNodeAssessmentRollups(graph);
  recomputeAreaRollups(graph);
  recomputeSummary(graph);

  return graph;
}

export function createInitialReviewDecisionFile(runtimeGraph, options = {}) {
  const graphPath = options.graphPath ?? "assessment-graph.runtime.json";
  const reviewer = options.reviewer ?? "agent:assessment-reviewer";
  const reviewedAt = options.reviewedAt ?? new Date().toISOString();
  return {
    version: "1.0.0",
    graphPath,
    reviewer,
    reviewedAt,
    decisions: (runtimeGraph.candidateSignals || []).map((signal) => ({
      candidateSignalId: signal.id,
      decision: "needs_more_evidence",
      confidence: "LOW",
      rationale: "TODO: inspect evidence refs, trace source, check tests/docs/counter-evidence, then change to accept or reject.",
      counterEvidenceChecked: [],
      openQuestions: ["Semantic review not completed yet."],
    })),
  };
}

export function reviewQueue(graph) {
  const grouped = {
    needs_agent_review: [],
    accepted: [],
    rejected: [],
  };
  for (const signal of graph.candidateSignals || []) {
    const status = signal.reviewStatus || "needs_agent_review";
    if (!grouped[status]) grouped[status] = [];
    grouped[status].push(signal);
  }
  for (const key of Object.keys(grouped)) grouped[key] = sortById(grouped[key]);
  return grouped;
}

export function dashboardReadiness(graph) {
  const pendingCandidates = (graph.candidateSignals || []).filter((s) => s.reviewStatus === "needs_agent_review").length;
  const hasSemanticNodes = (graph.assessmentNodes || []).length > 0;
  const reviewed = graph.artifact?.finalFindingsSource === "agent_review" || graph.artifact?.finalFindingsSource === "human_review";
  const readyForUser = reviewed && hasSemanticNodes && pendingCandidates === 0;
  return {
    readyForUser,
    pendingCandidates,
    hasSemanticNodes,
    reviewed,
    blockedReason: readyForUser
      ? null
      : "Complete semantic assessment before presenting dashboard/report: graph must be reviewed, contain semantic nodes, and have no pending candidate signals.",
  };
}

export function stableStringify(value) {
  return JSON.stringify(sortObjectKeys(value), null, 2) + "\n";
}

function assertDecisionFile(file) {
  if (!file || typeof file !== "object") throw new Error("review decision file must be an object");
  if (file.version !== "1.0.0") throw new Error(`review decision file version must be 1.0.0, got ${String(file.version)}`);
  assertNonEmptyString(file.graphPath, "review decision file graphPath");
  assertNonEmptyString(file.reviewer, "review decision file reviewer");
  assertNonEmptyString(file.reviewedAt, "review decision file reviewedAt");
  if (!Array.isArray(file.decisions)) throw new Error("review decision file decisions must be an array");
}

function assertDecision(decision) {
  assertNonEmptyString(decision.candidateSignalId, "decision.candidateSignalId");
  if (!["accept", "reject", "needs_more_evidence"].includes(decision.decision)) {
    throw new Error(`candidate signal ${decision.candidateSignalId}: invalid decision ${String(decision.decision)}`);
  }
  if (!CONFIDENCE_VALUES.has(decision.confidence)) {
    throw new Error(`candidate signal ${decision.candidateSignalId}: invalid confidence ${String(decision.confidence)}`);
  }
  assertNonEmptyString(decision.rationale, `candidate signal ${decision.candidateSignalId}: rationale`);
  if (decision.decision !== "needs_more_evidence") {
    assertNonEmptyStringArray(
      decision.counterEvidenceChecked,
      `candidate signal ${decision.candidateSignalId}: counterEvidenceChecked`,
    );
  }
  if (decision.semanticNode) assertSemanticNodeInput(decision.semanticNode, decision.candidateSignalId);
  if (decision.finding) assertNonEmptyString(decision.finding.id, `candidate signal ${decision.candidateSignalId}: finding.id`);
}

function assertSemanticNodeInput(input, candidateSignalId) {
  assertNonEmptyString(input.id, `candidate signal ${candidateSignalId}: semanticNode.id`);
  if (!SEMANTIC_NODE_KINDS.has(input.kind)) {
    throw new Error(`candidate signal ${candidateSignalId}: semanticNode.kind is invalid`);
  }
  assertNonEmptyString(input.name, `candidate signal ${candidateSignalId}: semanticNode.name`);
  assertNonEmptyString(input.summary, `candidate signal ${candidateSignalId}: semanticNode.summary`);
}

function buildPromotedFinding(candidate, decision, findingInput, source) {
  const {
    source: _candidateSource,
    reviewStatus: _reviewStatus,
    signalKind: _signalKind,
    promotedFindingId: _promotedFindingId,
    ...candidateFinding
  } = candidate;

  const finding = {
    ...candidateFinding,
    ...findingInput,
    id: findingInput.id,
    source,
    confidence: findingInput.confidence ?? decision.confidence,
    reasoningSummary: findingInput.reasoningSummary ?? decision.rationale,
    evidenceRefs: normalizeStringArray([
      ...(candidate.evidenceRefs ?? []),
      ...(findingInput.evidenceRefs ?? []),
      `candidate:${candidate.id}`,
    ]),
    counterEvidenceChecked: normalizeStringArray([
      ...decision.counterEvidenceChecked,
      ...(findingInput.counterEvidenceChecked ?? []),
    ]),
    openQuestions: normalizeStringArray(findingInput.openQuestions ?? decision.openQuestions ?? []),
    targetNodeIds: normalizeStringArray(findingInput.targetNodeIds ?? candidate.targetNodeIds),
  };

  assertNonEmptyString(finding.reasoningSummary, `candidate signal ${candidate.id}: finding.reasoningSummary`);
  assertNonEmptyStringArray(finding.evidenceRefs ?? [], `candidate signal ${candidate.id}: finding.evidenceRefs`);
  assertNonEmptyStringArray(
    finding.counterEvidenceChecked ?? [],
    `candidate signal ${candidate.id}: finding.counterEvidenceChecked`,
  );
  if (!finding.evidenceRefs?.includes(`candidate:${candidate.id}`)) {
    throw new Error(`candidate signal ${candidate.id}: accepted finding must cite candidate:${candidate.id}`);
  }
  return finding;
}

function buildSemanticNode(input, decision, candidate, finding, source) {
  const defaultStatus = source === "human_review" ? "human_confirmed" : "agent_inferred";
  return {
    id: input.id,
    kind: input.kind,
    name: input.name,
    summary: input.summary,
    status: input.status ?? defaultStatus,
    confidence: input.confidence ?? decision.confidence,
    evidenceRefs: normalizeStringArray([
      ...(input.evidenceRefs ?? []),
      ...(finding?.evidenceRefs ?? []),
      `candidate:${candidate.id}`,
      ...(finding ? [`finding:${finding.id}`] : []),
    ]),
    candidateSignalIds: normalizeStringArray([...(input.candidateSignalIds ?? []), candidate.id]),
    findingIds: normalizeStringArray([...(input.findingIds ?? []), ...(finding ? [finding.id] : [])]),
  };
}

function updateGapEdges(graph, promotedCandidateToFinding) {
  for (const edge of graph.edges || []) {
    const candidateSignalId = edge.gap?.candidateSignalId;
    if (!candidateSignalId) continue;
    const findingId = promotedCandidateToFinding.get(candidateSignalId);
    if (!findingId) continue;
    edge.gap = { ...edge.gap, findingId };
  }
}

function recomputeNodeAssessmentRollups(graph) {
  const findingById = new Map((graph.findings || []).map((finding) => [finding.id, finding]));
  const finalByNode = new Map();
  const candidatesByNode = new Map();

  for (const finding of graph.findings || []) {
    for (const nodeId of finding.targetNodeIds ?? []) addToMapList(finalByNode, nodeId, finding.id);
  }
  for (const signal of graph.candidateSignals || []) {
    for (const nodeId of signal.targetNodeIds ?? []) addToMapList(candidatesByNode, nodeId, signal.id);
  }

  for (const node of graph.nodes || []) {
    if (!node.assessment) continue;
    const findingIds = normalizeStringArray(finalByNode.get(node.id) ?? []);
    const candidateSignalIds = normalizeStringArray(candidatesByNode.get(node.id) ?? node.assessment.candidateSignalIds ?? []);
    const finalFindings = findingIds.map((id) => findingById.get(id)).filter(Boolean);
    const severities = finalFindings.map((finding) => finding.severity);
    const trust = weakestTrust(finalFindings.map((finding) => finding.evidence.strength)) ?? node.assessment.trust;

    node.assessment = {
      ...node.assessment,
      findingIds,
      candidateSignalIds,
      worstSeverity: worstSeverity(severities),
      readiness: readinessFrom(node.assessment.coverageStatus, severities),
      trust,
    };
  }
}

function recomputeAreaRollups(graph) {
  const nodeById = new Map((graph.nodes || []).map((node) => [node.id, node]));
  for (const area of graph.areas || []) {
    const severities = (area.nodeIds || [])
      .map((id) => nodeById.get(id)?.assessment?.worstSeverity)
      .filter(Boolean);
    area.worstSeverity = worstSeverity(severities);
  }
}

function recomputeSummary(graph) {
  const finalCounts = countFindings(graph.findings || []);
  const candidateCounts = countFindings(graph.candidateSignals || []);
  const accepted = (graph.candidateSignals || []).filter((signal) => signal.reviewStatus === "accepted").length;
  const rejected = (graph.candidateSignals || []).filter((signal) => signal.reviewStatus === "rejected").length;
  const pending = (graph.candidateSignals || []).filter((signal) => signal.reviewStatus === "needs_agent_review").length;

  graph.summary = {
    ...(graph.summary || {}),
    bySeverity: finalCounts.bySeverity,
    byCategory: finalCounts.byCategory,
    byDirection: finalCounts.byDirection,
    candidateBySeverity: candidateCounts.bySeverity,
    candidateByCategory: candidateCounts.byCategory,
    candidateByDirection: candidateCounts.byDirection,
    candidateSignalCount: (graph.candidateSignals || []).length,
    finalFindingCount: (graph.findings || []).length,
    assessmentNodeCount: (graph.assessmentNodes || []).length,
    headline:
      `reviewed assessment: ${(graph.findings || []).length} final finding(s), ` +
      `${accepted} accepted candidate(s), ${rejected} rejected candidate(s), ${pending} pending candidate(s), ` +
      `${(graph.assessmentNodes || []).length} semantic node(s). Headline trust: ${graph.coverage?.headlineTrust}.`,
  };
}

function countFindings(items) {
  const bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byCategory = {};
  const byDirection = { intent_to_code: 0, code_to_intent: 0, baseline_to_code: 0 };
  for (const item of items) {
    bySeverity[item.severity] += 1;
    byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
    byDirection[item.direction] += 1;
  }
  return { bySeverity, byCategory, byDirection };
}

function readinessFrom(coverageStatus, severities) {
  if (coverageStatus === "not_assessed") return "unknown";
  if (coverageStatus === "coverage_insufficient" || coverageStatus === "partial") return "partial";
  const worst = worstSeverity(severities);
  if (worst === "P0") return "blocked";
  if (worst) return "partial";
  return "ready";
}

function worstSeverity(severities) {
  let worst = null;
  for (const severity of severities) {
    if (!worst || SEVERITY_RANK[severity] > SEVERITY_RANK[worst]) worst = severity;
  }
  return worst;
}

function weakestTrust(values) {
  let weakest;
  for (const value of values) {
    if (!value) continue;
    if (!weakest || STRENGTH_RANK[value] < STRENGTH_RANK[weakest]) weakest = value;
  }
  return weakest;
}

function addToMapList(map, key, value) {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

function inferReviewSource(reviewer) {
  return String(reviewer).startsWith("human:") ? "human_review" : "agent_review";
}

function sortById(items) {
  return [...items].sort((a, b) => a.id.localeCompare(b.id));
}

function normalizeStringArray(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.trim().length > 0))].sort();
}

function assertNonEmptyString(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertNonEmptyStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`${label} must be a non-empty string array`);
  }
}

function sortObjectKeys(value) {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) {
    if (value[key] === undefined) continue;
    out[key] = sortObjectKeys(value[key]);
  }
  return out;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}
