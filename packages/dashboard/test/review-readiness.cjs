#!/usr/bin/env node
const assert = require("node:assert/strict");

function signal(id, reviewStatus, promotedFindingId) {
  return {
    id,
    reviewStatus,
    promotedFindingId,
    source: "runtime_candidate",
    severity: "P2",
    category: "quality",
    direction: "baseline_to_code",
    claim: `candidate ${id}`,
    evidence: { fact: `fact ${id}`, strength: "verified" },
    targetNodeIds: ["file:a.ts"],
    evidenceRefs: [`candidate:${id}`, "file:a.ts"],
    counterEvidenceChecked: reviewStatus === "needs_agent_review" ? [] : ["checked source"],
    openQuestions: [],
  };
}

function graph(overrides = {}) {
  return {
    artifact: { finalFindingsSource: "agent_review_required" },
    assessmentNodes: [],
    candidateSignals: [signal("A-001", "needs_agent_review")],
    findings: [],
    ...overrides,
  };
}

(async () => {
  const {
    getDashboardReadiness,
    groupCandidateSignalsByStatus,
    getCandidateLinkage,
    getFindingLinkage,
  } = await import("../src/reviewReadiness.mjs");

  const runtime = getDashboardReadiness(graph());
  assert.equal(runtime.state, "runtime_only");
  assert.equal(runtime.userFacingReady, false);
  assert.match(runtime.message, /not final findings/i);

  const partial = getDashboardReadiness(graph({
    artifact: { finalFindingsSource: "agent_review" },
    assessmentNodes: [{ id: "assessment:A-001", candidateSignalIds: ["A-001"], findingIds: [] }],
    candidateSignals: [signal("A-001", "needs_agent_review")],
  }));
  assert.equal(partial.state, "partial_review");
  assert.equal(partial.userFacingReady, false);
  assert.equal(partial.counts.pendingCandidates, 1);

  const reviewedGraph = graph({
    artifact: { finalFindingsSource: "agent_review" },
    assessmentNodes: [{ id: "assessment:A-001", candidateSignalIds: ["A-001"], findingIds: ["A-101"] }],
    candidateSignals: [signal("A-001", "accepted", "A-101"), signal("A-002", "rejected")],
    findings: [{ id: "A-101", evidenceRefs: ["candidate:A-001"], targetNodeIds: ["file:a.ts"] }],
  });
  const reviewed = getDashboardReadiness(reviewedGraph);
  assert.equal(reviewed.state, "reviewed_ready");
  assert.equal(reviewed.userFacingReady, true);

  const grouped = groupCandidateSignalsByStatus(reviewedGraph);
  assert.equal(grouped.accepted.length, 1);
  assert.equal(grouped.rejected.length, 1);
  assert.equal(grouped.needs_agent_review.length, 0);

  const candidateLinkage = getCandidateLinkage(reviewedGraph, "A-001");
  assert.deepEqual(candidateLinkage.assessmentNodeIds, ["assessment:A-001"]);
  assert.deepEqual(candidateLinkage.findingIds, ["A-101"]);

  const findingLinkage = getFindingLinkage(reviewedGraph, "A-101");
  assert.equal(findingLinkage.hasLinkageError, false);
  assert.deepEqual(findingLinkage.assessmentNodeIds, ["assessment:A-001"]);
  assert.deepEqual(findingLinkage.candidateSignalIds, ["A-001"]);

  const brokenLinkage = getFindingLinkage(graph({
    artifact: { finalFindingsSource: "agent_review" },
    assessmentNodes: [],
    candidateSignals: [signal("A-001", "accepted", "A-101")],
    findings: [{ id: "A-101", evidenceRefs: ["candidate:A-001"], targetNodeIds: ["file:a.ts"] }],
  }), "A-101");
  assert.equal(brokenLinkage.hasLinkageError, true);

  console.log("✓ dashboard review readiness helpers passed");
})();
