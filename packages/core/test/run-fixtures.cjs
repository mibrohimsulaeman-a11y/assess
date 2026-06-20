#!/usr/bin/env node
/*
 * Negative + positive fixtures for the honesty gate.
 *
 * A passing sample proves nothing about a VALIDATOR — it only proves the sample
 * is clean. This suite builds a minimal valid graph, applies one mutation per
 * case, and asserts the validator ACCEPTS the valid graph and REJECTS each
 * dishonest one. If a guard rule regresses, a fixture flips and this exits 1.
 *
 * Usage: node packages/core/test/run-fixtures.cjs
 */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const VALIDATOR = path.join(__dirname, "..", "scripts", "validate-graph.cjs");
const BINDING = { assessedAtCommit: "abc1234", intentSpecHash: "ispec:test", generated: "2026-01-01T00:00:00Z" };

function base() {
  return {
    version: "2.0.0",
    kind: "assessment",
    binding: { ...BINDING },
    project: { name: "fixture", languages: ["TypeScript"], frameworks: [], description: "fixture", analyzedAt: "2026-01-01T00:00:00Z", gitCommitHash: "abc1234" },
    artifact: {
      type: "semantic_assessment",
      factLayerRole: "deterministic_evidence_substrate",
      runtimeSignalsAreFinalFindings: false,
      finalFindingsSource: "agent_review_required",
      note: "runtime candidate signals require agent review before promotion",
    },
    intentModel: {
      lifecycle: "confirmed",
      confirmedCapabilityCount: 1,
      inferredCapabilityCount: 0,
      proposedCapabilityCount: 0,
      rejectedCapabilityCount: 0,
      entries: [{ id: "intent:x.do", status: "confirmed_intent", label: "do" }],
    },
    assessmentNodes: [],
    candidateSignals: [],
    intents: [{ id: "intent:x.do", type: "intent", name: "do", summary: "do", tags: ["intent"], complexity: "simple", intentMeta: { status: "CONFIRMED" } }],
    nodes: [
      {
        id: "file:a.ts",
        type: "file",
        name: "a.ts",
        filePath: "src/a.ts",
        assessment: {
          coverageStatus: "assessed",
          ownership: "owned",
          findingIds: [],
          readiness: "ready",
          worstSeverity: null,
          trust: "verified",
        },
      },
    ],
    edges: [],
    findings: [],
    areas: [{ id: "area:src", name: "src", description: "", nodeIds: ["file:a.ts"], coverageStatus: "assessed" }],
    coverage: {
      totalAreas: 1,
      totalNodes: 1,
      byStatus: { assessed: 1, partial: 0, not_assessed: 0, coverage_insufficient: 0 },
      headlineTrust: "verified",
      gaps: [],
    },
    summary: {
      bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 },
      byCategory: {},
      byDirection: { intent_to_code: 0, code_to_intent: 0, baseline_to_code: 0 },
      headline: "ok",
    },
  };
}

function finding(over) {
  return Object.assign(
    {
      id: "A-001",
      direction: "intent_to_code",
      category: "alignment.misalignment",
      claim: "claim",
      evidence: { fact: "f", strength: "verified" },
      intentRef: "intent:x.do",
      severity: "P2",
      confidence: "MED",
      explanation: "",
      recommendation: "",
      targetNodeIds: ["file:a.ts"],
      binding: { ...BINDING },
    },
    over,
  );
}

const cases = [
  { name: "valid-minimal", expect: "pass", mutate: (g) => g },
  {
    name: "absent-without-proof",
    expect: "fail",
    mutate: (g) => {
      g.findings.push(finding({ category: "alignment.missing", claim: "no implementing code", severity: "P2" }));
      return g;
    },
  },
  {
    name: "unproven-absence-high-severity",
    expect: "fail",
    mutate: (g) => {
      g.findings.push(
        finding({
          category: "alignment.missing",
          claim: "no code path",
          severity: "P1",
          missingCodeProof: { result: "not_found_in_index", coverage: 0.6 },
        }),
      );
      return g;
    },
  },

  {
    name: "unexplained-without-proof",
    expect: "fail",
    mutate: (g) => {
      g.findings.push(finding({
        direction: "code_to_intent",
        category: "alignment.unexplained",
        claim: "Significant exported component has no confirmed intent mapping in the supplied intent spec",
        severity: "P2",
        intentRef: "UNCONFIRMED",
      }));
      return g;
    },
  },

  {
    name: "runtime-signal-without-proof",
    expect: "fail",
    mutate: (g) => {
      g.candidateSignals.push({
        ...finding({ category: "alignment.missing", claim: "no implementing code", severity: "P2" }),
        source: "runtime_candidate",
        reviewStatus: "needs_agent_review",
        signalKind: "deterministic_gap",
        evidenceRefs: ["file:a.ts"],
        counterEvidenceChecked: [],
        openQuestions: ["agent review required"],
      });
      return g;
    },
  },
  {
    name: "unverifiable-high-severity",
    expect: "fail",
    mutate: (g) => {
      g.findings.push(finding({ severity: "P1", evidence: { fact: "guess", strength: "unverifiable" } }));
      return g;
    },
  },
  {
    name: "p0-against-unconfirmed-intent",
    expect: "fail",
    mutate: (g) => {
      g.findings.push(finding({ severity: "P0", intentRef: "UNCONFIRMED" }));
      return g;
    },
  },
  {
    name: "coverage-miscount",
    expect: "fail",
    mutate: (g) => {
      g.coverage.byStatus.assessed = 0;
      return g;
    },
  },

  {
    name: "coverage-gap-missing",
    expect: "fail",
    mutate: (g) => {
      g.nodes[0].assessment.coverageStatus = "not_assessed";
      g.nodes[0].assessment.notAssessedReason = "fixture intentionally not assessed";
      g.coverage.byStatus.assessed = 0;
      g.coverage.byStatus.not_assessed = 1;
      g.coverage.gaps = [];
      return g;
    },
  },
  {
    name: "dangling-edge",
    expect: "fail",
    mutate: (g) => {
      g.edges.push({ id: "e1", source: "file:a.ts", target: "file:ghost.ts", type: "contains", direction: "forward", weight: 1 });
      return g;
    },
  },
  {
    name: "duplicate-edge-id",
    expect: "fail",
    mutate: (g) => {
      const e = { id: "dup", source: "file:a.ts", target: "file:a.ts", type: "contains", direction: "forward", weight: 1 };
      g.edges.push({ ...e }, { ...e });
      return g;
    },
  },
  {
    name: "node-without-coverage-status",
    expect: "fail",
    mutate: (g) => {
      delete g.nodes[0].assessment;
      return g;
    },
  },
];

let failures = 0;
for (const c of cases) {
  const g = c.mutate(base());
  const tmp = path.join(os.tmpdir(), `assess-fixture-${c.name}.json`);
  fs.writeFileSync(tmp, JSON.stringify(g));
  let code = 0;
  try {
    execFileSync("node", [VALIDATOR, tmp], { stdio: "pipe" });
  } catch (e) {
    code = typeof e.status === "number" ? e.status : 1;
  }
  const got = code === 0 ? "pass" : "fail";
  const ok = got === c.expect;
  if (!ok) failures++;
  console.log(`${ok ? "\u2713" : "\u2717"} ${c.name}: expected ${c.expect}, got ${got}`);
}

if (failures) {
  console.error(`\n\u2717 ${failures} fixture(s) behaved unexpectedly`);
  process.exit(1);
}
console.log(`\n\u2713 all ${cases.length} fixtures behaved as expected (honesty gate holds)`);
