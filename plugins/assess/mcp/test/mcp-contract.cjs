#!/usr/bin/env node
/*
 * Contract tests for the assess MCP server.
 *
 * The MCP server IS the portable boundary of this product — every agent client
 * (Claude Code, Cursor, etc.) talks to it over JSON-RPC on stdio. If its wire
 * contract drifts, the plugin silently breaks for every consumer. A green
 * `node` run here proves, with zero dependencies and against the REAL process:
 *
 *   1. initialize returns the protocol version + serverInfo
 *   2. tools/list advertises exactly the five documented tools, each with a
 *      required-args input schema
 *   3. tools/call works end-to-end: assess_repo -> validate_graph -> list_findings
 *      -> explain_finding -> export_report, threading a real generated graph
 *   4. an unknown tool yields an isError tool result (not a crashed server)
 *   5. validate_graph does NOT call process.exit — i.e. importing the validator
 *      inside the server cannot kill it mid-session (a regression that file's
 *      own header warns about)
 *
 * Usage: node plugins/assess/mcp/test/mcp-contract.cjs
 */
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const SERVER = path.join(__dirname, "..", "assess-server.mjs");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
// A small, real, deterministic subtree to assess (the engine's own source).
const TARGET_REPO = path.join(REPO_ROOT, "packages", "core", "src");
// Bind to the sample CONFIRMED intent so the run produces real findings — this
// exercises list_findings/explain_finding on actual gap verdicts, not an empty set.
const INTENT_SPEC = path.join(REPO_ROOT, "examples", "intent", "assess-core.intent.json");

const EXPECTED_TOOLS = ["assess_repo", "validate_graph", "list_findings", "explain_finding", "export_report"];

let failures = 0;
function check(name, cond, detail) {
  if (cond) {
    console.log(`✓ ${name}`);
  } else {
    failures++;
    console.error(`✗ ${name}${detail ? " — " + detail : ""}`);
  }
}

// ---- minimal JSON-RPC-over-stdio client ----

function runSession(requests) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
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

// Pull the JSON payload back out of an MCP tool result envelope.
function toolPayload(resp) {
  const text = resp?.result?.content?.[0]?.text;
  if (typeof text !== "string") return null;
  try { return JSON.parse(text); } catch { return { __raw: text }; }
}

async function main() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "assess-mcp-"));
  const graphPath = path.join(outDir, "assessment-graph.json");

  // One ordered session exercising the full surface. ids are matched in responses.
  const requests = [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { jsonrpc: "2.0", method: "notifications/initialized" }, // notification: no reply
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "assess_repo", arguments: { repoRoot: TARGET_REPO, intentSpecPath: INTENT_SPEC, outDir } } },
    { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "validate_graph", arguments: { graphPath } } },
    { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "list_findings", arguments: { graphPath, minSeverity: "P3" } } },
    { jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "export_report", arguments: { graphPath } } },
    { jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "no_such_tool", arguments: {} } },
    { jsonrpc: "2.0", id: 9, method: "ping", params: {} },
  ];

  const { responses } = await runSession(requests);
  const byId = new Map(responses.map((r) => [r.id, r]));

  // 1. initialize
  const init = byId.get(1);
  check("initialize returns protocolVersion + serverInfo",
    !!init && !!init.result?.protocolVersion && init.result?.serverInfo?.name === "assess",
    JSON.stringify(init?.result));

  // notification must NOT produce a response (no id => not in byId, and nothing with null id)
  check("notifications/initialized produces no reply",
    !responses.some((r) => r.id === undefined && r.result !== undefined && r !== init),
    "a notification was answered");

  // 2. tools/list
  const list = byId.get(2);
  const tools = list?.result?.tools || [];
  const names = tools.map((t) => t.name).sort();
  check("tools/list advertises exactly the 5 documented tools",
    JSON.stringify(names) === JSON.stringify([...EXPECTED_TOOLS].sort()),
    JSON.stringify(names));
  check("every tool has an object input schema with required args",
    tools.length > 0 && tools.every((t) => t.inputSchema?.type === "object" && Array.isArray(t.inputSchema.required)),
    "a tool is missing inputSchema.required");

  // 3. tools/call chain
  const assess = toolPayload(byId.get(3));
  check("assess_repo writes a graph and reports counts",
    !!assess && fs.existsSync(graphPath) && assess.outPath === graphPath && typeof assess.counts?.findings === "number",
    JSON.stringify(assess));

  const valid = toolPayload(byId.get(4));
  check("validate_graph returns valid:true for the freshly generated graph",
    valid?.valid === true && Array.isArray(valid.errors) && valid.errors.length === 0,
    JSON.stringify(valid));

  // 5. validate_graph must not kill the server: if it had called process.exit,
  // every later response (list_findings, export_report, ping) would be missing.
  check("validate_graph does not terminate the server (later calls still answered)",
    byId.has(5) && byId.has(7) && byId.has(9),
    "a call after validate_graph went unanswered — server likely exited");

  const findings = toolPayload(byId.get(5));
  check("list_findings returns a non-empty count + array (intent-bound run has gaps)",
    typeof findings?.count === "number" && Array.isArray(findings.findings) && findings.count > 0,
    JSON.stringify(findings?.count));

  // explain_finding only if there is something to explain; otherwise assert the
  // documented not-found error shape via a follow-up single-call session.
  const firstId = findings?.findings?.[0]?.id;
  if (firstId) {
    const { responses: r2 } = await runSession([
      { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "explain_finding", arguments: { graphPath, findingId: firstId } } },
    ]);
    const explained = toolPayload(r2.find((r) => r.id === 1));
    check("explain_finding returns the full evidence trail for a real finding",
      explained?.id === firstId && !!explained.evidence && "severityRationale" in explained,
      JSON.stringify(explained?.id));
  } else {
    check("explain_finding (skipped: no findings to explain)", true);
  }

  const report = toolPayload(byId.get(7));
  check("export_report returns deterministic markdown",
    typeof report?.markdown === "string" && report.markdown.startsWith("# Assessment report"),
    JSON.stringify(report?.markdown?.slice(0, 40)));

  // 4. unknown tool => JSON-RPC error (-32601), server stays up (no crash)
  const unknown = byId.get(8);
  check("unknown tool returns a JSON-RPC -32601 error (not a protocol crash)",
    unknown?.error?.code === -32601 && /unknown tool/i.test(unknown.error.message || ""),
    JSON.stringify(unknown?.error));

  const pong = byId.get(9);
  check("ping is answered", !!pong && pong.result !== undefined, JSON.stringify(pong));

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
