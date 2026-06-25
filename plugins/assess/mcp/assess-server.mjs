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
//   review_queue             group pending/accepted/rejected candidate signals
//   apply_review_decisions   apply review.decisions.json -> reviewed graph
//   list_findings            list final agent/human-reviewed findings
//   list_candidate_signals   list deterministic runtime signals awaiting review
//   explain_finding          full evidence + reasoning for one final finding
//   explain_candidate_signal full deterministic evidence for one runtime signal
//   export_report            deterministic Markdown report from a reviewed graph
//
// This keeps boundaries clear: runtime tools produce facts/candidate signals;
// agents promote only high-quality, reasoned items into final findings.
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { assessRepo } from "../../../packages/core/runtime/engine.mjs";
import {
  applyReviewDecisions,
  dashboardReadiness,
  reviewQueue,
  stableStringify,
} from "../../../packages/core/runtime/review-core.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const VALIDATOR = path.join(REPO_ROOT, "packages/core/scripts/validate-graph.cjs");
const PROJECT_ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const PROJECT_ROOT_RESOLVED = fs.realpathSync(PROJECT_ROOT);

const SERVER_INFO = { name: "assess", version: "2.0.0" };

const TOOLS = [
  {
    name: "assess_repo",
    description: "Scan a repository, build a deterministic fact index, optionally bind confirmed/proposed intent, and emit a validated semantic assessment shell. Runtime outputs candidateSignals only; final findings require agent/human review.",
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
    name: "review_queue",
    description: "Return candidate signals grouped by review status so an agent can review every runtime signal before presenting dashboard/report output.",
    inputSchema: {
      type: "object",
      properties: {
        graphPath: { type: "string", description: "Path to a runtime or reviewed assessment graph." },
        status: { type: "string", enum: ["needs_agent_review", "accepted", "rejected"], description: "Optional status bucket to return." },
      },
      required: ["graphPath"],
    },
  },
  {
    name: "apply_review_decisions",
    description: "Apply a review.decisions.json file to a runtime graph and write a reviewed graph. Strict mode rejects unresolved candidate decisions.",
    inputSchema: {
      type: "object",
      properties: {
        graphPath: { type: "string", description: "Path to assessment-graph.runtime.json or runtime assessment-graph.json." },
        decisionPath: { type: "string", description: "Path to review.decisions.json." },
        outPath: { type: "string", description: "Path to write assessment-graph.reviewed.json." },
        finalFindingsSource: { type: "string", enum: ["agent_review", "human_review"], description: "Optional override for final finding source." },
      },
      required: ["graphPath", "decisionPath", "outPath"],
    },
  },
  {
    name: "list_findings",
    description: "List final curated findings only. Runtime candidate signals are intentionally excluded; use list_candidate_signals for deterministic signals awaiting agent review.",
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
    name: "list_candidate_signals",
    description: "List deterministic runtime candidate signals, optionally filtered by minimum severity and/or direction. These are evidence-backed signals, not final findings.",
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
    description: "Return the full evidence and semantic reasoning trail for one final finding. Final findings must come from agent/human review, not raw runtime signals.",
    inputSchema: {
      type: "object",
      properties: { graphPath: { type: "string" }, findingId: { type: "string" } },
      required: ["graphPath", "findingId"],
    },
  },

  {
    name: "explain_candidate_signal",
    description: "Return the deterministic evidence trail for one runtime candidate signal. Use this as substrate for agent semantic review; do not treat it as a final finding.",
    inputSchema: {
      type: "object",
      properties: { graphPath: { type: "string" }, signalId: { type: "string" } },
      required: ["graphPath", "signalId"],
    },
  },
  {
    name: "export_report",
    description: "Produce a deterministic Markdown assessment report from a reviewed assessment graph. Runtime-only graphs are blocked by default; pass allowRuntimeOnly only for internal debugging.",
    inputSchema: {
      type: "object",
      properties: {
        graphPath: { type: "string" },
        allowRuntimeOnly: { type: "boolean", description: "Internal/debug override. Do not use for user-facing reports." },
      },
      required: ["graphPath"],
    },
  },
];

const SEV_ORDER = ["P3", "P2", "P1", "P0"];

function isInsideProject(resolvedPath) {
  const relative = path.relative(PROJECT_ROOT_RESOLVED, resolvedPath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hasParentTraversal(inputPath) {
  return inputPath.split(/[\\/]+/).includes("..");
}

function nearestExistingPath(absPath) {
  let current = absPath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) throw new Error(`no existing ancestor for ${absPath}`);
    current = parent;
  }
  return current;
}

function resolveInsideProject(inputPath, label) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error(`${label} must be a non-empty path`);
  }
  const absPath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(PROJECT_ROOT_RESOLVED, inputPath);
  if (fs.existsSync(absPath)) {
    const resolvedPath = fs.realpathSync(absPath);
    if (!isInsideProject(resolvedPath)) {
      throw new Error(`${label} must stay inside CLAUDE_PROJECT_DIR (${PROJECT_ROOT_RESOLVED})`);
    }
    return resolvedPath;
  }
  if (hasParentTraversal(inputPath)) {
    throw new Error(`${label} must not contain '..' path segments`);
  }

  const existingPath = nearestExistingPath(absPath);
  const existingResolved = fs.realpathSync(existingPath);
  if (!isInsideProject(existingResolved)) {
    throw new Error(`${label} must stay inside CLAUDE_PROJECT_DIR (${PROJECT_ROOT_RESOLVED})`);
  }

  const relativeTail = path.relative(existingPath, absPath);
  const resolvedPath = relativeTail ? path.resolve(existingResolved, relativeTail) : existingResolved;
  if (!isInsideProject(resolvedPath)) {
    throw new Error(`${label} must stay inside CLAUDE_PROJECT_DIR (${PROJECT_ROOT_RESOLVED})`);
  }
  return resolvedPath;
}

function readGraph(graphPath) {
  const abs = resolveInsideProject(graphPath, "graphPath");
  return JSON.parse(fs.readFileSync(abs, "utf8"));
}

function publicFinding(x) {
  return {
    id: x.id,
    severity: x.severity,
    direction: x.direction,
    category: x.category,
    claim: x.claim,
    intentRef: x.intentRef ?? null,
    targetNodeIds: x.targetNodeIds ?? [],
    evidence: x.evidence,
    missingCodeProof: x.missingCodeProof ?? null,
  };
}

function publicCandidateSignal(x) {
  return {
    ...publicFinding(x),
    source: x.source,
    reviewStatus: x.reviewStatus,
    signalKind: x.signalKind,
    promotedFindingId: x.promotedFindingId ?? null,
    evidenceRefs: x.evidenceRefs ?? [],
    counterEvidenceChecked: x.counterEvidenceChecked ?? [],
    openQuestions: x.openQuestions ?? [],
  };
}

function writeJsonAtomic(filePath, value) {
  const abs = resolveInsideProject(filePath, "outPath");
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmpPath = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
  fs.writeFileSync(tmpPath, stableStringify(value));
  fs.renameSync(tmpPath, abs);
  return abs;
}

function readJsonInsideProject(filePath, label) {
  const abs = resolveInsideProject(filePath, label);
  return { abs, value: JSON.parse(fs.readFileSync(abs, "utf8")) };
}

// ---- tool implementations ----

const handlers = {
  assess_repo(args) {
    const repoRoot = resolveInsideProject(args.repoRoot, "repoRoot");
    const defaultOutDir = path.join(repoRoot, ".assessment");
    const outDir = resolveInsideProject(args.outDir || defaultOutDir, "outDir");
    const intentSpecPath = args.intentSpecPath ? resolveInsideProject(args.intentSpecPath, "intentSpecPath") : undefined;
    const { graph, outPath, summary, intentGate } = assessRepo({ repoRoot, intentSpecPath, outDir });
    return {
      summary: summary.headline,
      mode: summary.hasIntent ? "intent-bound" : "baseline-only",
      // G1: the intent-confirmation gate. When state !== "confirmed" the agent must
      // stop and confirm intent with the user before presenting alignment results.
      intentGate,
      outPath,
      dashboard: (() => {
        const readiness = dashboardReadiness(graph);
        return readiness.readyForUser
          ? {
              ...readiness,
              graphPath: outPath,
              devCommand: `ASSESS_GRAPH=${JSON.stringify(outPath)} pnpm dev:dashboard`,
            }
          : {
              ...readiness,
              graphPath: outPath,
            };
      })(),
      counts: {
        files: summary.files,
        nodes: summary.nodes,
        finalFindings: graph.findings.length,
        candidateSignals: graph.candidateSignals?.length ?? 0,
        assessmentNodes: graph.assessmentNodes?.length ?? 0,
      },
      artifact: graph.artifact,
      intentModel: graph.intentModel,
      bySeverity: graph.summary.bySeverity,
      candidateBySeverity: graph.summary.candidateBySeverity,
      headlineTrust: graph.coverage.headlineTrust,
      coverage: graph.coverage.byStatus,
      intentCoverage: graph.coverage.intentCoverage,
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
  review_queue(args) {
    const g = readGraph(args.graphPath);
    const grouped = reviewQueue(g);
    const selected = args.status ? { [args.status]: grouped[args.status] ?? [] } : grouped;
    const counts = Object.fromEntries(Object.entries(grouped).map(([status, items]) => [status, items.length]));
    return {
      graphPath: resolveInsideProject(args.graphPath, "graphPath"),
      artifact: g.artifact,
      readiness: dashboardReadiness(g),
      counts,
      candidateSignals: Object.fromEntries(
        Object.entries(selected).map(([status, items]) => [status, items.map(publicCandidateSignal)]),
      ),
    };
  },
  apply_review_decisions(args) {
    const runtimeGraph = readGraph(args.graphPath);
    const { value: decisionFile } = readJsonInsideProject(args.decisionPath, "decisionPath");
    const reviewedGraph = applyReviewDecisions(runtimeGraph, decisionFile, {
      finalFindingsSource: args.finalFindingsSource,
    });
    const mod = require(VALIDATOR);
    const res = mod.validate(reviewedGraph);
    if (res.errors.length) {
      throw new Error(`reviewed graph failed validation: ${res.errors.join("; ")}`);
    }
    const outPath = writeJsonAtomic(args.outPath, reviewedGraph);
    return {
      outPath,
      valid: true,
      warnings: res.warnings,
      readiness: dashboardReadiness(reviewedGraph),
      counts: {
        finalFindings: reviewedGraph.findings?.length ?? 0,
        candidateSignals: reviewedGraph.candidateSignals?.length ?? 0,
        assessmentNodes: reviewedGraph.assessmentNodes?.length ?? 0,
      },
      artifact: reviewedGraph.artifact,
    };
  },
  list_findings(args) {
    const g = readGraph(args.graphPath);
    let f = g.findings || [];
    if (args.minSeverity) f = f.filter((x) => SEV_ORDER.indexOf(x.severity) >= SEV_ORDER.indexOf(args.minSeverity));
    if (args.direction) f = f.filter((x) => x.direction === args.direction);
    return {
      finalOnly: true,
      candidateSignalCount: g.candidateSignals?.length ?? 0,
      count: f.length,
      findings: f.map(publicFinding),
    };
  },
  list_candidate_signals(args) {
    const g = readGraph(args.graphPath);
    let f = g.candidateSignals || [];
    if (args.minSeverity) f = f.filter((x) => SEV_ORDER.indexOf(x.severity) >= SEV_ORDER.indexOf(args.minSeverity));
    if (args.direction) f = f.filter((x) => x.direction === args.direction);
    return {
      finalFindingsCount: g.findings?.length ?? 0,
      count: f.length,
      candidateSignals: f.map(publicCandidateSignal),
    };
  },
  explain_finding(args) {
    const g = readGraph(args.graphPath);
    const f = (g.findings || []).find((x) => x.id === args.findingId);
    if (!f) throw new Error(`final finding ${args.findingId} not found`);
    return {
      ...publicFinding(f),
      source: f.source ?? null,
      reasoningSummary: f.reasoningSummary ?? null,
      evidenceRefs: f.evidenceRefs ?? [],
      counterEvidenceChecked: f.counterEvidenceChecked ?? [],
      openQuestions: f.openQuestions ?? [],
      severityRationale: f.explanation,
      recommendation: f.recommendation,
      binding: f.binding,
    };
  },
  explain_candidate_signal(args) {
    const g = readGraph(args.graphPath);
    const f = (g.candidateSignals || []).find((x) => x.id === args.signalId);
    if (!f) throw new Error(`candidate signal ${args.signalId} not found`);
    return {
      ...publicFinding(f),
      source: f.source,
      reviewStatus: f.reviewStatus,
      signalKind: f.signalKind,
      evidenceRefs: f.evidenceRefs ?? [],
      counterEvidenceChecked: f.counterEvidenceChecked ?? [],
      openQuestions: f.openQuestions ?? [],
      severityRationale: f.explanation,
      recommendation: f.recommendation,
      binding: f.binding,
    };
  },
  export_report(args) {
    const g = readGraph(args.graphPath);
    const readiness = dashboardReadiness(g);
    const runtimeOnly = !readiness.readyForUser;
    if (runtimeOnly && args.allowRuntimeOnly !== true) {
      throw new Error(readiness.blockedReason);
    }
    // The report's job is the SEMANTIC conclusion + the evidence and coverage that
    // make it trustworthy. Deterministic candidate signals are substrate: they fold
    // INTO findings as evidence, and aggregate as coverage — they are not the report.
    // Reviewed-and-rejected signals are clustered (not re-listed per item); the raw
    // per-item runtime list lives in an appendix, shown only for runtime-only graphs
    // or when explicitly requested for debugging.
    const lines = [];
    const finalFindings = g.findings || [];
    const candidateSignals = g.candidateSignals || [];

    lines.push(`# Assessment report — ${g.project.name}`, "");
    lines.push(`> ${g.summary.headline}`, "");
    lines.push(`- Commit: \`${g.binding.assessedAtCommit}\``);
    lines.push(`- Intent spec: \`${g.binding.intentSpecHash}\``);
    lines.push(`- Final findings source: ${g.artifact?.finalFindingsSource ?? "legacy"}`, "");

    // --- Coverage & honesty: promoted to a first-class section ---
    lines.push("## Coverage & honesty", "");
    lines.push(`- Headline trust: **${g.coverage.headlineTrust}**`);
    const ic = g.coverage.intentCoverage;
    if (ic) {
      if (ic.capabilitiesClaimed > 0) {
        const pct = Math.round((ic.mappedRatio ?? 0) * 100);
        lines.push(`- Alignment coverage: **${ic.componentsMapped}/${ic.componentsTotal} components (${pct}%)** across ${ic.capabilitiesClaimed} confirmed capability(ies); intent provenance: **${ic.weakestProvenance ?? "unknown"}**`);
        lines.push(`  - Only this mapped surface was assessed for intent↔code alignment; the rest passed through baseline→code only.`);
      } else {
        lines.push(`- Alignment coverage: **none** — ${ic.note}`);
      }
    }
    lines.push(`- Code coverage: ${JSON.stringify(g.coverage.byStatus)}`);
    if (g.coverage.gaps && g.coverage.gaps.length) {
      lines.push(`- NOT fully assessed (${g.coverage.gaps.length}):`);
      for (const gap of g.coverage.gaps) lines.push(`  - **${gap.scope}** — ${gap.status}: ${gap.reason}`);
    }
    lines.push("");

    // --- Findings: the semantic conclusion, with evidence folded in ---
    lines.push("## Findings", "");
    lines.push(`${finalFindings.length} final finding(s), promoted from ${candidateSignals.length} deterministic candidate signal(s) by semantic review.`, "");
    if (!finalFindings.length) {
      lines.push(runtimeOnly
        ? "_No final findings yet. This is a runtime-only graph; candidate signals require agent/human semantic review before they become findings (see appendix)._"
        : "_No final findings: semantic review promoted none of the candidate signals into real problems._", "");
    }
    for (const sev of ["P0", "P1", "P2", "P3"]) {
      const fs2 = finalFindings.filter((f) => f.severity === sev);
      if (!fs2.length) continue;
      lines.push(`### ${sev} (${fs2.length})`, "");
      for (const f of fs2) {
        lines.push(`- **${f.id}** [${f.direction}] ${f.claim}`);
        lines.push(`  - Evidence (${f.evidence.strength}): ${f.evidence.fact}`);
        if (f.reasoningSummary) lines.push(`  - Reasoning: ${f.reasoningSummary}`);
        if (f.missingCodeProof) lines.push(`  - Absence proof: ${f.missingCodeProof.result} (coverage ${f.missingCodeProof.coverage.actual}/${f.missingCodeProof.coverage.required})`);
        if (f.openQuestions && f.openQuestions.length) lines.push(`  - Open question: ${f.openQuestions[0]}`);
        if (f.recommendation) lines.push(`  - Fix: ${f.recommendation}`);
      }
      lines.push("");
    }

    // --- Reviewed & dismissed: clustered by claim with rationale, not per-item ---
    const rejected = candidateSignals.filter((s) => s.reviewStatus === "rejected");
    if (rejected.length) {
      const rationaleBySignal = new Map();
      for (const node of g.assessmentNodes || []) {
        for (const sid of node.candidateSignalIds || []) {
          if (!rationaleBySignal.has(sid)) rationaleBySignal.set(sid, node.summary);
        }
      }
      const clusters = new Map(); // claim -> { count, rationale, ids[] }
      for (const s of rejected) {
        const c = clusters.get(s.claim) ?? { count: 0, rationale: rationaleBySignal.get(s.id), ids: [] };
        c.count += 1;
        c.ids.push(s.id);
        if (!c.rationale) c.rationale = rationaleBySignal.get(s.id);
        clusters.set(s.claim, c);
      }
      lines.push("## Reviewed & dismissed", "");
      lines.push(`${rejected.length} candidate signal(s) were reviewed and dismissed as not real problems, grouped below:`, "");
      for (const [claim, c] of [...clusters.entries()].sort((a, b) => b[1].count - a[1].count)) {
        lines.push(`- **${c.count}×** ${claim}`);
        if (c.rationale) lines.push(`  - Why dismissed: ${c.rationale}`);
      }
      lines.push("");
    }

    // --- Appendix: raw deterministic substrate, only for runtime-only/debug ---
    if (candidateSignals.length && (runtimeOnly || args.allowRuntimeOnly === true)) {
      lines.push("## Appendix — runtime candidate signals (deterministic substrate)", "");
      lines.push("These are raw deterministic signals, NOT findings. They are the substrate an agent reviews; promote only after semantic review.", "");
      for (const sev of ["P0", "P1", "P2", "P3"]) {
        const fs2 = candidateSignals.filter((f) => f.severity === sev);
        if (!fs2.length) continue;
        lines.push(`### ${sev} candidates (${fs2.length})`, "");
        for (const f of fs2) lines.push(`- **${f.id}** [${f.direction}] ${f.claim}${f.reviewStatus && f.reviewStatus !== "needs_agent_review" ? ` _(reviewed: ${f.reviewStatus})_` : ""}`);
        lines.push("");
      }
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
