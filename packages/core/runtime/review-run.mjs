#!/usr/bin/env node
// =====================================================================
// review-run — review decision workflow CLI bridge.
//
// Runtime scan writes candidateSignals only. This bridge makes the review pass
// auditable and repeatable:
//
//   init     graph -> review.decisions.json template
//   apply    graph + decisions -> assessment-graph.reviewed.json
//   validate reviewed graph honesty gate
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import {
  applyReviewDecisions,
  createInitialReviewDecisionFile,
  dashboardReadiness,
  stableStringify,
} from "./review-core.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.join(__dirname, "../scripts/validate-graph.cjs");

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) out[key] = true;
      else out[key] = argv[++i];
    } else {
      out._.push(arg);
    }
  }
  return out;
}

function usage() {
  return `Usage:
  node packages/core/runtime/review-run.mjs init --graph <runtime.json> [--out review.decisions.json] [--reviewer agent:assessment-reviewer]
  node packages/core/runtime/review-run.mjs apply --graph <runtime.json> --decisions <review.decisions.json> --out <reviewed.json> [--source agent_review|human_review]
  node packages/core/runtime/review-run.mjs validate --graph <reviewed.json>
`;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJsonAtomic(filePath, value) {
  const abs = path.resolve(filePath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, stableStringify(value));
  fs.renameSync(tmp, abs);
}

function validateGraphObject(graph) {
  const { validate } = require(VALIDATOR);
  const verdict = validate(graph);
  if (verdict.errors.length) {
    throw new Error(
      `reviewed graph failed validation (${verdict.errors.length} error(s)):\n  - ` +
        verdict.errors.join("\n  - "),
    );
  }
  return verdict;
}

function runValidatorCli(graphPath) {
  const { runCli } = require(VALIDATOR);
  return runCli(["node", VALIDATOR, path.resolve(graphPath)]);
}

function init(args) {
  if (!args.graph) throw new Error("init requires --graph");
  const graphPath = path.resolve(args.graph);
  const outPath = path.resolve(args.out || path.join(path.dirname(graphPath), "review.decisions.json"));
  const graph = readJson(graphPath);
  const decisionFile = createInitialReviewDecisionFile(graph, {
    graphPath: path.relative(path.dirname(outPath), graphPath) || path.basename(graphPath),
    reviewer: args.reviewer || "agent:assessment-reviewer",
  });
  writeJsonAtomic(outPath, decisionFile);
  console.log(`wrote ${outPath}`);
  console.log(`${decisionFile.decisions.length} candidate decision(s) initialized as needs_more_evidence`);
}

function apply(args) {
  if (!args.graph) throw new Error("apply requires --graph");
  if (!args.decisions) throw new Error("apply requires --decisions");
  if (!args.out) throw new Error("apply requires --out");
  const runtimeGraph = readJson(args.graph);
  const decisionFile = readJson(args.decisions);
  const reviewedGraph = applyReviewDecisions(runtimeGraph, decisionFile, {
    finalFindingsSource: args.source,
  });
  const verdict = validateGraphObject(reviewedGraph);
  writeJsonAtomic(args.out, reviewedGraph);
  const readiness = dashboardReadiness(reviewedGraph);
  console.log(`wrote ${path.resolve(args.out)}`);
  console.log(`validated (${verdict.assessableCount} assessable nodes, ${verdict.findingCount} findings, ${verdict.candidateSignalCount} candidate signals)`);
  console.log(readiness.readyForUser ? "dashboard/report ready" : `dashboard/report blocked: ${readiness.blockedReason}`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const command = args._[0];
  try {
    if (!command || command === "-h" || command === "--help" || args.help) {
      process.stdout.write(usage());
      process.exit(0);
    }
    if (command === "init") init(args);
    else if (command === "apply") apply(args);
    else if (command === "validate") {
      if (!args.graph) throw new Error("validate requires --graph");
      process.exit(runValidatorCli(args.graph));
    } else {
      throw new Error(`unknown command ${command}`);
    }
  } catch (error) {
    console.error(`ERROR ${error.message}`);
    process.stderr.write(usage());
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
