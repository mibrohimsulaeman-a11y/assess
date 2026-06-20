#!/usr/bin/env node
/*
 * Review decision workflow fixtures.
 *
 * Proves the M1 contract:
 *   runtime graph + review.decisions.json -> reviewed graph
 *   accepted candidates become linked final findings
 *   rejected candidates remain explicit but do not create final findings
 *   unresolved/invalid decisions cannot produce a reviewed artifact
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { validate } = require("../scripts/validate-graph.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const FIXTURE_DIR = path.join(__dirname, "fixtures", "review-decisions", "accept-one");
const REVIEW_RUN = path.join(__dirname, "..", "runtime", "review-run.mjs");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    console.error(`✗ ${name}`);
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  }
}

function checkThrows(name, fn, pattern) {
  check(name, () => {
    assert.throws(fn, pattern);
  });
}

function assertValidReviewed(graph) {
  const verdict = validate(graph);
  assert.deepEqual(verdict.errors, []);
}

function acceptDecision(candidateSignalId, findingId, semanticNodeId) {
  return {
    candidateSignalId,
    decision: "accept",
    confidence: "MED",
    rationale: `Reviewed ${candidateSignalId} and confirmed the semantic gap.`,
    counterEvidenceChecked: ["checked related source files", "checked tests", "checked docs"],
    semanticNode: {
      id: semanticNodeId,
      kind: "workflow",
      name: `Semantic review ${candidateSignalId}`,
      summary: `Semantic review node for ${candidateSignalId}.`,
    },
    finding: {
      id: findingId,
      claim: `Reviewed final finding for ${candidateSignalId}.`,
      reasoningSummary: `The runtime signal ${candidateSignalId} was confirmed after counter-evidence review.`,
      evidenceRefs: [`candidate:${candidateSignalId}`],
      targetNodeIds: ["file:a.ts"],
      openQuestions: [],
    },
  };
}

function rejectDecision(candidateSignalId, semanticNodeId) {
  return {
    candidateSignalId,
    decision: "reject",
    confidence: "HIGH",
    rationale: `Reviewed ${candidateSignalId} and rejected it as not semantically actionable.`,
    counterEvidenceChecked: ["checked related source files", "checked tests", "checked docs"],
    semanticNode: {
      id: semanticNodeId,
      kind: "evidence_bundle",
      name: `Rejected signal ${candidateSignalId}`,
      summary: `Counter-evidence review rejected ${candidateSignalId}.`,
    },
  };
}

function decisionFile(decisions) {
  return {
    version: "1.0.0",
    graphPath: "assessment-graph.runtime.json",
    reviewer: "agent:assessment-reviewer",
    reviewedAt: "2026-01-01T01:00:00.000Z",
    decisions,
  };
}

function graphWithSecondCandidate(runtimeGraph) {
  const graph = clone(runtimeGraph);
  const first = graph.candidateSignals[0];
  const second = {
    ...clone(first),
    id: "A-002",
    claim: "Second candidate for duplicate finding id fixture",
    evidenceRefs: ["candidate:A-002", "file:a.ts", "file:src/a.ts:1-20", "intent:review.workflow"],
  };
  graph.candidateSignals.push(second);
  graph.nodes[0].assessment.candidateSignalIds.push("A-002");
  graph.edges.push({
    ...clone(graph.edges[0]),
    id: "edge:A-002",
    gap: { ...graph.edges[0].gap, candidateSignalId: "A-002" },
  });
  graph.summary.candidateSignalCount = 2;
  graph.summary.candidateBySeverity.P2 = 2;
  graph.summary.candidateByCategory["alignment.misalignment"] = 2;
  graph.summary.candidateByDirection.intent_to_code = 2;
  return graph;
}

async function main() {
  const { applyReviewDecisions, stableStringify } = await import("../runtime/review-core.mjs");
  const runtime = readJson(path.join(FIXTURE_DIR, "assessment-graph.runtime.json"));
  const decisions = readJson(path.join(FIXTURE_DIR, "review.decisions.json"));
  const expected = readJson(path.join(FIXTURE_DIR, "assessment-graph.reviewed.expected.json"));

  check("accept-one applies to expected reviewed graph", () => {
    const reviewed = applyReviewDecisions(runtime, decisions);
    assert.equal(stableStringify(reviewed), stableStringify(expected));
  });

  check("accept-one reviewed graph passes honesty validator", () => {
    assertValidReviewed(expected);
  });

  check("applyReviewDecisions does not mutate the runtime graph", () => {
    const before = stableStringify(runtime);
    applyReviewDecisions(runtime, decisions);
    assert.equal(stableStringify(runtime), before);
  });

  check("review-run apply writes a validator-clean reviewed graph", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "assess-review-fixture-"));
    const runtimePath = path.join(tempDir, "assessment-graph.runtime.json");
    const decisionsPath = path.join(tempDir, "review.decisions.json");
    const outPath = path.join(tempDir, "assessment-graph.reviewed.json");
    fs.writeFileSync(runtimePath, stableStringify(runtime));
    fs.writeFileSync(decisionsPath, stableStringify(decisions));
    execFileSync("node", [REVIEW_RUN, "apply", "--graph", runtimePath, "--decisions", decisionsPath, "--out", outPath], {
      cwd: ROOT,
      stdio: "pipe",
    });
    const actual = readJson(outPath);
    assert.equal(stableStringify(actual), stableStringify(expected));
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  check("reject-one produces valid reviewed graph without final finding", () => {
    const reviewed = applyReviewDecisions(runtime, decisionFile([rejectDecision("A-001", "assessment:reject-A-001")]));
    assert.equal(reviewed.findings.length, 0);
    assert.equal(reviewed.candidateSignals[0].reviewStatus, "rejected");
    assert.equal(reviewed.assessmentNodes.length, 1);
    assertValidReviewed(reviewed);
  });

  checkThrows(
    "needs-more-evidence strict apply fails",
    () => applyReviewDecisions(runtime, decisionFile([{
      candidateSignalId: "A-001",
      decision: "needs_more_evidence",
      confidence: "LOW",
      rationale: "More source tracing is required before this can be reviewed.",
      counterEvidenceChecked: [],
      openQuestions: ["Need broader source read."],
    }])),
    /needs_more_evidence is not allowed/,
  );

  checkThrows(
    "missing-candidate decision fails",
    () => applyReviewDecisions(runtime, decisionFile([rejectDecision("A-404", "assessment:reject-A-404")])),
    /unknown candidate signal A-404/,
  );

  checkThrows(
    "accept without semantic node fails",
    () => applyReviewDecisions(runtime, decisionFile([{
      ...acceptDecision("A-001", "A-101", "assessment:A-001"),
      semanticNode: undefined,
    }])),
    /requires semanticNode/,
  );

  checkThrows(
    "accept without counter-evidence fails",
    () => applyReviewDecisions(runtime, decisionFile([{
      ...acceptDecision("A-001", "A-101", "assessment:A-001"),
      counterEvidenceChecked: [],
    }])),
    /counterEvidenceChecked/,
  );

  checkThrows(
    "duplicate finding id fails",
    () => applyReviewDecisions(
      graphWithSecondCandidate(runtime),
      decisionFile([
        acceptDecision("A-001", "A-101", "assessment:A-001"),
        acceptDecision("A-002", "A-101", "assessment:A-002"),
      ]),
    ),
    /duplicate finding id A-101/,
  );

  check("idempotent output is byte-stable for same graph and decisions", () => {
    const first = applyReviewDecisions(runtime, decisions);
    const second = applyReviewDecisions(runtime, decisions);
    assert.equal(stableStringify(first), stableStringify(second));
  });
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
