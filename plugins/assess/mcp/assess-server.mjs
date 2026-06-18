#!/usr/bin/env node
// =====================================================================
// assess MCP server — the portable executable assessment boundary.
//
// Zero-dependency JSON-RPC 2.0 over stdio (newline-delimited). It implements
// just enough of the Model Context Protocol (initialize / tools/list /
// tools/call) to run with plain `node` before any SDK is installed — same
// discipline as the validator and the engine. Any MCP client (Claude Code,
// Cursor, Codex-like agents) can call these tools:
//
//   assess_repo      read repo (+optional intent) -> assessment-graph.json
//   validate_graph   structural + honesty validation of a graph
//   list_findings    list findings, filterable by severity / direction
//   explain_finding  full evidence + proof + severity rationale for one finding
//   export_report    deterministic Markdown report from a graph
//
// This is what keeps findings evidence-bound: the agent calls a deterministic
// tool instead of judging the code freely.
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { assessRepo } from "../../../packages/core/runtime/engine.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const VALIDATOR = path.join(REPO_ROOT, "packages/core/scripts/validate-graph.cjs");
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();

const SERVER_INFO = { name: "assess", version: "2.0.0" };

const TOOLS = [
  {
    name: "assess_repo",
    description: "Scan a repository, build a deterministic index, optionally bind it to a confirmed intent spec, run the three assessment directions, and emit a validated assessment-graph.json. Returns the summary and findings.",
    inputSchema: {
      type: "object",
      properties: {
        repoRoot: { type: "string", description: "Path to the repository (or subtree) to assess." },
        intentSpecPath: { type: "string", description: "Optional path to a CONFIRMED intent spec JSON. Omit for an honest baseline-only assessment." },
        outDir: { type: "string", description: "Optional output dir. Defaults to <repoRoot>/.assessment." },
      },
      required: ["repoRoot"],
    },
  },
  {
    name: "validate_graph",
    description: "Run the zero-dependency structural + honesty validator against an assessment-graph.json file. Fails if any finding claims more than its evidence supports.",
    inputSchema: {
      type: "object",
      properties: { graphPath: { type: "string", description: "Path to assessment-graph.json." } },
      required: ["graphPath"],
    },
  },
  {
    name: "list_findings",
    description: "List findings from an assessment graph, optionally filtered by minimum severity (P0..P3) and/or direction.",
    inputSchema: {
      type: "object",
      properties: {
        graphPath: { type: "string" },
        minSeverity: { type: "string", enum: ["P0", "P1", "P2", "P3"] },
        direction: { type: "string", enum: ["intent_to_code", "code_to_intent", "baseline_to_code"] },
      },
      required: ["graphPath"],
    },
  },
  {
    name: "explain_finding",
    description: "Return the full evidence trail for one finding: deterministic fact, evidence strength, missing-code proof (if any), severity rationale, and the intent/code it binds.",
    inputSchema: {
      type: "object",
      properties: { graphPath: { type: "string" }, findingId: { type: "string" } },
      required: ["graphPath", "findingId"],
    },
  },
  {
    name: "export_report",
    description: "Produce a deterministic Markdown assessment report (summary, coverage, findings grouped by severity) from an assessment graph.",
    inputSchema: {
      type: "object",
      properties: { graphPath: { type: "string" } },
      required: ["graphPath"],
    },
  },
];

const SEV_ORDER = ["P3", "P2", "P1", "P0"];

function resolveProjectPath(inputPath) {
  return path.isAbsolute(inputPath) ? inputPath : path.resolve(PROJECT_ROOT, inputPath);
}

function readGraph(graphPath) {
  const abs = resolveProjectPath(graphPath);
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

// ---- tool implementations ----

const handlers = {
  assess_repo(args) {
    const repoRoot = resolveProjectPath(args.repoRoot);
    const outDir = args.outDir ? resolveProjectPath(args.outDir) : path.join(repoRoot, ".assessment");
    const intentSpecPath = args.intentSpecPath ? resolveProjectPath(args.intentSpecPath) : undefined;
    const { graph, outPath, summary } = assessRepo({ repoRoot, intentSpecPath, outDir });
    return {
      summary: summary.headline,
      mode: summary.hasIntent ? "intent-bound" : "baseline-only",
      outPath,
      dashboard: {
        graphPath: outPath,
        devCommand: `ASSESS_GRAPH=${JSON.stringify(outPath)} pnpm dev:dashboard`,
      },
      counts: { files: summary.files, nodes: summary.nodes, findings: summary.findings },
      bySeverity: graph.summary.bySeverity,
      headlineTrust: graph.coverage.headlineTrust,
      coverage: graph.coverage.byStatus,
    };
  },
  validate_graph(args) {
    const mod = require(VALIDATOR);
    const graph = readGraph(args.graphPath);
    const res = mod.validate(graph);
    return {
      valid: res.errors.length === 0,
      errors: res.errors,
      warnings: res.warnings,
      assessableCount: res.assessableCount,
      findingCount: res.findingCount,
    };
  },
  list_findings(args) {
    const g = readGraph(args.graphPath);
    let f = g.findings;
    if (args.minSeverity) f = f.filter((x) => SEV_ORDER.indexOf(x.severity) >= SEV_ORDER.indexOf(args.minSeverity));
    if (args.direction) f = f.filter((x) => x.direction === args.direction);
    return {
      count: f.length,
      findings: f.map((x) => ({
        id: x.id,
        severity: x.severity,
        direction: x.direction,
        category: x.category,
        claim: x.claim,
        intentRef: x.intentRef ?? null,
        targetNodeIds: x.targetNodeIds ?? [],
        evidence: x.evidence,
        missingCodeProof: x.missingCodeProof ?? null,
      })),
    };
  },
  explain_finding(args) {
    const g = readGraph(args.graphPath);
    const f = g.findings.find((x) => x.id === args.findingId);
    if (!f) throw new Error(`finding ${args.findingId} not found`);
    return {
      id: f.id, severity: f.severity, direction: f.direction, category: f.category,
      claim: f.claim, evidence: f.evidence, missingCodeProof: f.missingCodeProof ?? null,
      severityRationale: f.explanation, recommendation: f.recommendation,
      intentRef: f.intentRef ?? null, targetNodeIds: f.targetNodeIds, binding: f.binding,
    };
  },
  export_report(args) {
    const g = readGraph(args.graphPath);
    const lines = [];
    lines.push(`# Assessment report — ${g.project.name}`, "");
    lines.push(`> ${g.summary.headline}`, "");
    lines.push(`- Commit: \`${g.binding.assessedAtCommit}\``);
    lines.push(`- Intent spec: \`${g.binding.intentSpecHash}\``);
    lines.push(`- Headline trust: **${g.coverage.headlineTrust}**`);
    lines.push(`- Coverage: ${JSON.stringify(g.coverage.byStatus)}`, "");
    if (g.coverage.gaps && g.coverage.gaps.length) {
      lines.push("## Coverage gaps", "");
      for (const gap of g.coverage.gaps) lines.push(`- **${gap.scope}** — ${gap.status}: ${gap.reason}`);
      lines.push("");
    }
    lines.push("## Findings", "");
    if (!g.findings.length) lines.push("_No findings._", "");
    for (const sev of ["P0", "P1", "P2", "P3"]) {
      const fs2 = g.findings.filter((f) => f.severity === sev);
      if (!fs2.length) continue;
      lines.push(`### ${sev} (${fs2.length})`, "");
      for (const f of fs2) {
        lines.push(`- **${f.id}** [${f.direction}] ${f.claim}`);
        lines.push(`  - Evidence (${f.evidence.strength}): ${f.evidence.fact}`);
        if (f.missingCodeProof) lines.push(`  - Absence proof: ${f.missingCodeProof.result} (coverage ${f.missingCodeProof.coverage.actual}/${f.missingCodeProof.coverage.required})`);
        if (f.recommendation) lines.push(`  - Fix: ${f.recommendation}`);
      }
      lines.push("");
    }
    return { markdown: lines.join("\n") };
  },
};

// ---- JSON-RPC plumbing ----

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
function ok(id, result) { send({ jsonrpc: "2.0", id, result }); }
function fail(id, code, message) { send({ jsonrpc: "2.0", id, error: { code, message } }); }

function toolResult(payload) {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function handle(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return ok(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: SERVER_INFO });
  }
  if (method === "notifications/initialized" || method === "initialized") return; // notification, no reply
  if (method === "ping") return ok(id, {});
  if (method === "tools/list") return ok(id, { tools: TOOLS });
  if (method === "tools/call") {
    const name = params?.name;
    const fn = handlers[name];
    if (!fn) return fail(id, -32601, `unknown tool: ${name}`);
    try {
      const payload = fn(params.arguments || {});
      return ok(id, toolResult(payload));
    } catch (e) {
      return ok(id, { content: [{ type: "text", text: `ERROR: ${e.message}` }], isError: true });
    }
  }
  if (id !== undefined) fail(id, -32601, `unknown method: ${method}`);
}

function main() {
  let buf = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      let msg;
      try { msg = JSON.parse(line); } catch { continue; }
      try { handle(msg); } catch (e) { if (msg && msg.id !== undefined) fail(msg.id, -32603, e.message); }
    }
  });
  process.stdin.on("end", () => process.exit(0));
  process.stderr.write(`assess MCP server ready (${TOOLS.length} tools) on stdio\n`);
}

// Exported for in-process tests; runs as a server when invoked directly.
export { TOOLS, handlers };
if (import.meta.url === pathToFileURL(process.argv[1] || "").href) main();
