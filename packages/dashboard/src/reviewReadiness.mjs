export const REVIEW_STATUS = ["needs_agent_review", "accepted", "rejected"];

export function groupCandidateSignalsByStatus(graph) {
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
  for (const status of Object.keys(grouped)) {
    grouped[status] = [...grouped[status]].sort((a, b) => a.id.localeCompare(b.id));
  }
  return grouped;
}

export function getDashboardReadiness(graph) {
  const grouped = groupCandidateSignalsByStatus(graph);
  const pendingCandidates = grouped.needs_agent_review.length;
  const acceptedCandidates = grouped.accepted.length;
  const rejectedCandidates = grouped.rejected.length;
  const candidateSignalCount = (graph.candidateSignals || []).length;
  const assessmentNodeCount = (graph.assessmentNodes || []).length;
  const finalFindingCount = (graph.findings || []).length;
  const finalFindingsSource = graph.artifact?.finalFindingsSource || "agent_review_required";
  const reviewedSource = finalFindingsSource === "agent_review" || finalFindingsSource === "human_review";

  if (finalFindingsSource === "agent_review_required") {
    return {
      state: "runtime_only",
      userFacingReady: false,
      title: "Dashboard is in internal preview mode.",
      message:
        "Semantic review is incomplete. Candidate signals are deterministic runtime signals, not final findings. Apply review decisions and validate the reviewed graph before presenting this dashboard/report.",
      blockedReasons: [
        "artifact.finalFindingsSource is agent_review_required",
        `${pendingCandidates} candidate signal(s) still need agent review`,
      ],
      counts: { pendingCandidates, acceptedCandidates, rejectedCandidates, candidateSignalCount, assessmentNodeCount, finalFindingCount },
    };
  }

  const blockedReasons = [];
  if (!reviewedSource) blockedReasons.push(`artifact.finalFindingsSource is ${finalFindingsSource}`);
  if (pendingCandidates > 0) blockedReasons.push(`${pendingCandidates} candidate signal(s) still need agent review`);
  if (assessmentNodeCount === 0) blockedReasons.push("reviewed graph has no semantic assessment nodes");

  if (blockedReasons.length > 0) {
    return {
      state: "partial_review",
      userFacingReady: false,
      title: "Dashboard is blocked: partial review only.",
      message:
        "Some review metadata exists, but semantic review is not complete. Keep this dashboard internal until every candidate is accepted or rejected, semantic nodes are present, and validation passes.",
      blockedReasons,
      counts: { pendingCandidates, acceptedCandidates, rejectedCandidates, candidateSignalCount, assessmentNodeCount, finalFindingCount },
    };
  }

  return {
    state: "reviewed_ready",
    userFacingReady: true,
    title: "Reviewed graph is user-facing ready.",
    message:
      "Semantic review is complete for this artifact. Candidate signals are closed as accepted or rejected, semantic nodes are present, and final findings are review-derived.",
    blockedReasons: [],
    counts: { pendingCandidates, acceptedCandidates, rejectedCandidates, candidateSignalCount, assessmentNodeCount, finalFindingCount },
  };
}

export function getFindingLinkage(graph, findingId) {
  const finding = (graph.findings || []).find((item) => item.id === findingId) || null;
  const assessmentNodeIds = [];
  const candidateSignalIds = new Set();
  const evidenceRefs = finding?.evidenceRefs || [];

  for (const node of graph.assessmentNodes || []) {
    if ((node.findingIds || []).includes(findingId)) {
      assessmentNodeIds.push(node.id);
      for (const candidateSignalId of node.candidateSignalIds || []) candidateSignalIds.add(candidateSignalId);
    }
  }

  for (const ref of evidenceRefs) {
    if (typeof ref === "string" && ref.startsWith("candidate:")) {
      candidateSignalIds.add(ref.slice("candidate:".length));
    }
  }

  for (const signal of graph.candidateSignals || []) {
    if (signal.promotedFindingId === findingId) candidateSignalIds.add(signal.id);
  }

  const candidateSignalIdList = [...candidateSignalIds].sort();
  return {
    finding,
    assessmentNodeIds: assessmentNodeIds.sort(),
    candidateSignalIds: candidateSignalIdList,
    evidenceRefs,
    hasLinkageError: Boolean(finding) && assessmentNodeIds.length === 0,
  };
}

export function getCandidateLinkage(graph, candidateSignalId) {
  const candidate = (graph.candidateSignals || []).find((item) => item.id === candidateSignalId) || null;
  const assessmentNodeIds = [];
  const findingIds = new Set();

  for (const node of graph.assessmentNodes || []) {
    if ((node.candidateSignalIds || []).includes(candidateSignalId)) {
      assessmentNodeIds.push(node.id);
      for (const findingId of node.findingIds || []) findingIds.add(findingId);
    }
  }

  if (candidate?.promotedFindingId) findingIds.add(candidate.promotedFindingId);

  return {
    candidate,
    assessmentNodeIds: assessmentNodeIds.sort(),
    findingIds: [...findingIds].sort(),
    evidenceRefs: candidate?.evidenceRefs || [],
    targetNodeIds: candidate?.targetNodeIds || [],
    counterEvidenceChecked: candidate?.counterEvidenceChecked || [],
    openQuestions: candidate?.openQuestions || [],
  };
}
