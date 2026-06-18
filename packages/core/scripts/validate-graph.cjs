#!/usr/bin/env node
/*
 * Dependency-free validator for assessment-graph.json.
 *
 * Mirrors the invariants in src/overlay/validate.ts but uses zero imports so it
 * runs in CI with plain `node` before anything is installed. Checks:
 *   1. required top-level shape + kind === "assessment"
 *   2. referential integrity (edge endpoints, finding refs, edge->finding)
 *   3. coverage completeness (every assessable node has a status; manifest tallies)
 *   4. honesty rules (absence claims need a proof; severity respects evidence caps)
 *
 * CLI usage: node validate-graph.cjs <path-to-graph.json>
 * Exit 0 = valid, 1 = errors found.
 *
 * Also exports validate(graph) for the MCP server. Importing this file must not
 * read process.argv or call process.exit; otherwise validate_graph kills the MCP
 * server instead of returning a tool result.
 */
const fs = require("node:fs");

function validate(graph) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);

  // 1. shape
  for (const key of ["version", "kind", "binding", "project", "nodes", "edges", "findings", "areas", "coverage", "summary"]) {
    if (!(key in graph)) err(`missing top-level key: ${key}`);
  }
  if (graph.kind !== "assessment") err(`kind must be "assessment", got ${JSON.stringify(graph.kind)}`);

  const allNodes = [...(graph.nodes || []), ...(graph.intents || [])];
  const nodeIds = new Set(allNodes.map((n) => n.id));
  const findingIds = new Set((graph.findings || []).map((f) => f.id));
  const SENTINELS = new Set(["baseline", "intent:UNCONFIRMED"]);
  const known = (id) => nodeIds.has(id) || SENTINELS.has(id);

  // 2. referential integrity
  for (const e of graph.edges || []) {
    if (!known(e.source)) err(`edge ${e.id}: source ${e.source} not found`);
    if (!known(e.target)) err(`edge ${e.id}: target ${e.target} not found`);
    if (e.gap && e.gap.findingId && !findingIds.has(e.gap.findingId)) {
      err(`edge ${e.id}: unknown finding ${e.gap.findingId}`);
    }
  }
  for (const f of graph.findings || []) {
    for (const t of f.targetNodeIds || []) {
      if (!known(t)) err(`finding ${f.id}: target ${t} not found`);
    }
  }

  // 3. coverage completeness
  const assessable = (graph.nodes || []).filter((n) => n.type !== "intent" && n.type !== "capability");
  for (const n of assessable) {
    if (!n.assessment || !n.assessment.coverageStatus) err(`node ${n.id}: no assessment.coverageStatus`);
  }
  const bs = (graph.coverage && graph.coverage.byStatus) || {};
  const counted = (bs.assessed || 0) + (bs.partial || 0) + (bs.not_assessed || 0) + (bs.coverage_insufficient || 0);
  if (counted !== assessable.length) {
    err(`coverage manifest counts ${counted} but there are ${assessable.length} assessable nodes`);
  }

  // 4. honesty rules
  for (const f of graph.findings || []) {
    const claimsAbsence =
      f.category === "alignment.missing" || /no (implementing|code|path)|dead code|never called/i.test(f.claim || "");
    if (claimsAbsence && !f.missingCodeProof) {
      err(`finding ${f.id}: claims absence without a missing-code proof`);
    }
    if (claimsAbsence && f.missingCodeProof && f.missingCodeProof.result !== "absent" && (f.severity === "P0" || f.severity === "P1")) {
      err(`finding ${f.id}: ${f.severity} but absence is only ${f.missingCodeProof.result} (unproven absence caps at P2)`);
    }
    if (f.evidence && f.evidence.strength === "unverifiable" && (f.severity === "P0" || f.severity === "P1")) {
      err(`finding ${f.id}: ${f.severity} on unverifiable evidence (cap P2)`);
    }
    if (f.intentRef === "UNCONFIRMED" && f.severity === "P0") {
      err(`finding ${f.id}: P0 against UNCONFIRMED intent (cap P2)`);
    }
  }

  return {
    errors,
    warnings,
    assessableCount: assessable.length,
    findingCount: (graph.findings || []).length,
  };
}

function readGraph(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function runCli(argv) {
  const filePath = argv[2];
  if (!filePath) {
    console.error("usage: node validate-graph.cjs <graph.json>");
    return 2;
  }

  const graph = readGraph(filePath);
  const res = validate(graph);
  for (const w of res.warnings) console.warn("WARN  " + w);
  for (const e of res.errors) console.error("ERROR " + e);

  if (res.errors.length) {
    console.error(`\n✗ ${res.errors.length} error(s), ${res.warnings.length} warning(s)`);
    return 1;
  }
  console.log(`✓ assessment-graph.json valid (${res.assessableCount} assessable nodes, ${res.findingCount} findings, ${res.warnings.length} warning(s))`);
  return 0;
}

module.exports = { validate, readGraph, runCli };

if (require.main === module) {
  process.exit(runCli(process.argv));
}
