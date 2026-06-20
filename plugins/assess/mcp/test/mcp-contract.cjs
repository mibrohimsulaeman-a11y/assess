#!/usr/bin/env node
/*
 * Contract tests for the assess MCP server.
 *
 * Proves the portable boundary:
 *   1. initialize + tools/list stay stable
 *   2. assess_repo produces a runtime graph with candidate signals only
 *   3. review_queue exposes every pending signal before presentation
 *   4. export_report blocks runtime-only graphs by default
 *   5. apply_review_decisions converts runtime + review.decisions.json into a
 *      validator-clean reviewed graph
 *   6. reviewed graph APIs expose final findings, reviewed candidates, and report
 *   7. path boundary and unknown-tool failures do not crash the server
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "assess-server.mjs");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const TARGET_REPO = path.join(REPO_ROOT, "packages", "core", "src");
const INTENT_SPEC = path.join(REPO_ROOT, "examples", "intent", "assess-core.intent.json");

const EXPECTED_TOOLS = [
  "assess_repo",
  "validate_graph",
  "review_queue",
  "apply_review_decisions",
  "list_findings",
  "list_candidate_signals",
  "explain_finding",
  "explain_candidate_signal",
  "export_report",
];

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

function runSession(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, CLAUDE_PROJECT_DIR: REPO_ROOT },
    });
    let out = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("server did not respond within 30s"));
    }, 30_000);

    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", () => {
      clearTimeout(timer);
      const responses = out
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .map((l) => {
          try { return JSON.parse(l); } catch { return null; }
        })
        .filter(Boolean);
      resolve({ responses, stderr });
    });

    for (const req of requests) child.stdin.write(JSON.stringify(req) + "\n");
    child.stdin.end();
  });
}

function toolPayload(resp) {
  const text = resp?.result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}

function sanitizeId(id) {
  return String(id).replace(/[^A-Za-z0-9_-]+/g, "-");
}

function buildDecisionFile(graph, decisionPath) {
  const signals = graph.candidateSignals || [];
  const accepted = signals[0];
  if (!accepted) throw new Error("assessment did not produce candidate signals for MCP contract");
  const acceptedFindingId = `R-${sanitizeId(accepted.id)}`;
  const decisions = signals.map((signal, index) => {
    const semanticNode = {
      id: `assessment:${sanitizeId(signal.id)}`,
      kind: index === 0 ? "workflow" : "evidence_bundle",
      name: index === 0 ? `Reviewed ${signal.id}` : `Rejected ${signal.id}`,
      summary: index === 0
        ? `Semantic review promoted ${signal.id} into a final finding.`
        : `Semantic review rejected ${signal.id} after counter-evidence review.`,
    };
    if (index > 0) {
      return {
        candidateSignalId: signal.id,
        decision: "reject",
        confidence: "MED",
        rationale: `MCP contract rejects ${signal.id} to prove all candidates can be closed without becoming findings.`,
        counterEvidenceChecked: ["checked related source files", "checked tests", "checked docs"],
        semanticNode,
      };
    }
    return {
      candidateSignalId: signal.id,
      decision: "accept",
      confidence: signal.confidence || "MED",
      rationale: `MCP contract promotes ${signal.id} to verify final finding application and linkage.`,
      counterEvidenceChecked: ["checked related source files", "checked tests", "checked docs"],
      semanticNode,
      finding: {
        id: acceptedFindingId,
        claim: `Reviewed MCP contract finding for ${signal.id}: ${signal.claim}`,
        severity: signal.severity,
        reasoningSummary: `The runtime signal ${signal.id} was promoted by the MCP contract after explicit counter-evidence checks.`,
        evidenceRefs: [`candidate:${signal.id}`, ...(signal.evidenceRefs || []).filter((ref) => ref.startsWith("file:")).slice(0, 2)],
        targetNodeIds: signal.targetNodeIds || [],
        openQuestions: [],
      },
    };
  });
  const file = {
    version: "1.0.0",
    graphPath: path.basename(graphPathForDecision(decisionPath)),
    reviewer: "agent:assessment-reviewer",
    reviewedAt: "2026-01-01T01:00:00.000Z",
    decisions,
  };
  fs.writeFileSync(decisionPath, JSON.stringify(file, null, 2));
  return { file, acceptedFindingId };
}

function graphPathForDecision(decisionPath) {
  return path.join(path.dirname(decisionPath), "assessment-graph.json");
}

async function main() {
  const assessmentDir = path.join(REPO_ROOT, ".assessment");
  fs.mkdirSync(assessmentDir, { recursive: true });
  const outDir = fs.mkdtempSync(path.join(assessmentDir, "mcp-contract-"));
  const graphPath = path.join(outDir, "assessment-graph.json");
  const decisionPath = path.join(outDir, "review.decisions.json");
  const reviewedGraphPath = path.join(outDir, "assessment-graph.reviewed.json");

  const runtimeRequests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "assess_repo", arguments: { repoRoot: TARGET_REPO, intentSpecPath: INTENT_SPEC, outDir } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "validate_graph", arguments: { graphPath } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "review_queue", arguments: { graphPath } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "list_findings", arguments: { graphPath, minSeverity: "P3" } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "list_candidate_signals", arguments: { graphPath, minSeverity: "P3" } } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "export_report", arguments: { graphPath } } },
    { jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 10, method: "ping", params: {} },
  ];

  const { responses } = await runSession(runtimeRequests);
  const byId = new Map(responses.map((r) => [r.id, r]));

  const init = byId.get(1);
  check("initialize returns protocolVersion + serverInfo",
    !!init && !!init.result?.protocolVersion && init.result?.serverInfo?.name === "assess",
    JSON.stringify(init?.result));

  check("notifications/initialized produces no reply",
    !responses.some((r) => r.id === undefined && r.result !== undefined && r !== init),
    "a notification was answered");

  const list = byId.get(2);
  const tools = list?.result?.tools || [];
  const names = tools.map((t) => t.name).sort();
  check("tools/list advertises exactly the documented semantic-boundary tools",
    JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
    JSON.stringify(names));
  check("every tool has an object input schema with required args",
    tools.length > 0 && tools.every((t) => t.inputSchema?.type === "object" && Array.isArray(t.inputSchema.required)),
    "a tool is missing inputSchema.required");

  const assess = toolPayload(byId.get(3));
  check("assess_repo writes a runtime graph and reports candidate counts",
    !!assess && fs.existsSync(graphPath) && assess.outPath === graphPath && assess.counts?.finalFindings === 0 && assess.counts?.candidateSignals > 0,
    JSON.stringify(assess));

  const validRuntime = toolPayload(byId.get(4));
  check("validate_graph returns valid:true for the freshly generated runtime graph",
    validRuntime?.valid === true && Array.isArray(validRuntime.errors) && validRuntime.errors.length === 0,
    JSON.stringify(validRuntime));

  check("validate_graph does not terminate the server (later calls still answered)",
    byId.has(5) && byId.has(6) && byId.has(7) && byId.has(10),
    "a call after validate_graph went unanswered — server likely exited");

  const queue = toolPayload(byId.get(5));
  check("review_queue exposes pending runtime candidate signals",
    queue?.counts?.needs_agent_review > 0 && queue?.readiness?.readyForUser === false,
    JSON.stringify(queue?.counts));

  const runtimeFindings = toolPayload(byId.get(6));
  check("list_findings returns final-only empty findings for a runtime-only run",
    runtimeFindings?.count === 0 && runtimeFindings.finalOnly === true,
    JSON.stringify(runtimeFindings));

  const runtimeSignals = toolPayload(byId.get(7));
  check("list_candidate_signals returns deterministic runtime signals awaiting review",
    runtimeSignals?.count > 0 && runtimeSignals.candidateSignals?.[0]?.reviewStatus === "needs_agent_review",
    JSON.stringify(runtimeSignals?.count));

  const blockedReport = byId.get(8);
  check("export_report blocks runtime-only graph by default",
    blockedReport?.result?.isError === true && /Complete semantic assessment/i.test(blockedReport.result.content?.[0]?.text || ""),
    JSON.stringify(blockedReport));

  const unknown = byId.get(9);
  check("unknown tool returns a JSON-RPC -32601 error (not a protocol crash)",
    unknown?.error?.code === -32601 && /unknown tool/i.test(unknown.error.message || ""),
    JSON.stringify(unknown?.error));

  const pong = byId.get(10);
  check("ping is answered", !!pong && pong.result !== undefined, JSON.stringify(pong));

  const runtimeGraph = JSON.parse(fs.readFileSync(graphPath, "utf8"));
  const { acceptedFindingId } = buildDecisionFile(runtimeGraph, decisionPath);

  const reviewedRequests = [
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "apply_review_decisions", arguments: { graphPath, decisionPath, outPath: reviewedGraphPath } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "validate_graph", arguments: { graphPath: reviewedGraphPath } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "review_queue", arguments: { graphPath: reviewedGraphPath } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list_findings", arguments: { graphPath: reviewedGraphPath, minSeverity: "P3" } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_candidate_signals", arguments: { graphPath: reviewedGraphPath, minSeverity: "P3" } } },
    { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "explain_finding", arguments: { graphPath: reviewedGraphPath, findingId: acceptedFindingId } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "export_report", arguments: { graphPath: reviewedGraphPath } } },
    { jsonrpc: "2.0", id: 8, method: "ping", params: {} },
  ];
  const { responses: reviewedResponses } = await runSession(reviewedRequests);
  const reviewedById = new Map(reviewedResponses.map((r) => [r.id, r]));

  const applied = toolPayload(reviewedById.get(1));
  check("apply_review_decisions writes reviewed graph and reports dashboard readiness",
    applied?.valid === true && fs.existsSync(reviewedGraphPath) && applied.readiness?.readyForUser === true && applied.counts?.finalFindings === 1,
    JSON.stringify(applied));

  const validReviewed = toolPayload(reviewedById.get(2));
  check("validate_graph returns valid:true for reviewed graph",
    validReviewed?.valid === true && Array.isArray(validReviewed.errors) && validReviewed.errors.length === 0,
    JSON.stringify(validReviewed));

  const reviewedQueue = toolPayload(reviewedById.get(3));
  check("review_queue shows no pending candidates after apply",
    reviewedQueue?.counts?.needs_agent_review === 0 && reviewedQueue?.counts?.accepted === 1 && reviewedQueue?.readiness?.readyForUser === true,
    JSON.stringify(reviewedQueue?.counts));

  const finalFindings = toolPayload(reviewedById.get(4));
  check("list_findings returns the promoted final finding",
    finalFindings?.count === 1 && finalFindings.findings?.[0]?.id === acceptedFindingId,
    JSON.stringify(finalFindings));

  const reviewedSignals = toolPayload(reviewedById.get(5));
  check("list_candidate_signals returns reviewed statuses, not pending statuses",
    reviewedSignals?.count > 0 && reviewedSignals.candidateSignals.every((s) => s.reviewStatus !== "needs_agent_review"),
    JSON.stringify(reviewedSignals?.candidateSignals?.slice(0, 2)));

  const explained = toolPayload(reviewedById.get(6));
  check("explain_finding returns evidence and review reasoning for the promoted finding",
    explained?.id === acceptedFindingId && explained.source === "agent_review" && explained.evidenceRefs?.some((ref) => ref.startsWith("candidate:")),
    JSON.stringify(explained));

  const report = toolPayload(reviewedById.get(7));
  check("export_report returns deterministic markdown for reviewed graph",
    typeof report?.markdown === "string" && report.markdown.startsWith("# Assessment report") && report.markdown.includes(acceptedFindingId),
    JSON.stringify(report?.markdown?.slice(0, 80)));

  check("ping remains answered after reviewed workflow", !!reviewedById.get(8)?.result, JSON.stringify(reviewedById.get(8)));

  const { responses: boundaryResponses } = await runSession([
    { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "assess_repo", arguments: { repoRoot: "../../../../" } } },
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "validate_graph", arguments: { graphPath: "/etc/passwd" } } },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "apply_review_decisions", arguments: { graphPath, decisionPath, outPath: "/tmp/escape.json" } } },
  ]);
  const boundaryById = new Map(boundaryResponses.map((r) => [r.id, r]));
  const traversalRepo = boundaryById.get(1);
  const absoluteGraph = boundaryById.get(2);
  const absoluteOut = boundaryById.get(3);
  check("assess_repo rejects relative traversal outside CLAUDE_PROJECT_DIR",
    traversalRepo?.result?.isError === true && /path segments|CLAUDE_PROJECT_DIR/i.test(traversalRepo.result.content?.[0]?.text || ""),
    JSON.stringify(traversalRepo));
  check("validate_graph rejects absolute paths outside CLAUDE_PROJECT_DIR",
    absoluteGraph?.result?.isError === true && /CLAUDE_PROJECT_DIR/i.test(absoluteGraph.result.content?.[0]?.text || ""),
    JSON.stringify(absoluteGraph));
  check("apply_review_decisions rejects outPath outside CLAUDE_PROJECT_DIR",
    absoluteOut?.result?.isError === true && /CLAUDE_PROJECT_DIR/i.test(absoluteOut.result.content?.[0]?.text || ""),
    JSON.stringify(absoluteOut));

  fs.rmSync(outDir, { recursive: true, force: true });

  if (failures) {
    console.error(`\n✗ ${failures} MCP contract check(s) failed`);
    process.exit(1);
  }
  console.log(`\n✓ all MCP contract checks passed (server boundary holds)`);
}

main().catch((e) => {
  console.error("MCP contract test crashed:", e.message);
  process.exit(1);
});
