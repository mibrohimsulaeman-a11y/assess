#!/usr/bin/env node
// =====================================================================
// assess-run — OPTIONAL tiny CLI shim (dev/CI/debug only).
//
// This is NOT the product. The product surface is the Claude Code plugin and
// the MCP server. This shim only exists so contributors and CI can run the
// exact same deterministic engine from a terminal:
//
//   node packages/core/runtime/assess-run.mjs --repo . [--intent spec.json] [--out .assessment]
//
// It writes a validated assessment-graph.json and prints the summary. Exit code
// is non-zero if the honesty/structure validator rejects the graph.
// =====================================================================

import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { assessRepo } from "./engine.mjs";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR = path.join(__dirname, "../scripts/validate-graph.cjs");

function shellQuote(value) {
  return JSON.stringify(String(value));
}

function parseArgs(argv) {
  const out = { repo: ".", out: null, intent: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--repo") out.repo = argv[++i];
    else if (a === "--intent") out.intent = argv[++i];
    else if (a === "--out") out.out = argv[++i];
    else if (a === "-h" || a === "--help") out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node assess-run.mjs --repo <dir> [--intent <spec.json>] [--out <dir>]");
    process.exit(0);
  }
  const repoRoot = path.resolve(args.repo);
  const outDir = path.resolve(args.out || path.join(repoRoot, ".assessment"));
  const { graph, outPath, summary } = assessRepo({ repoRoot, intentSpecPath: args.intent, outDir });
  console.log(summary.headline);
  console.log(`wrote ${outPath}`);
  if (graph.artifact?.finalFindingsSource === "agent_review_required") {
    console.log("dashboard pending semantic assessment");
    console.log(`internal preview ASSESS_GRAPH=${shellQuote(outPath)} pnpm dev:dashboard`);
  } else {
  console.log(`dashboard ASSESS_GRAPH=${shellQuote(outPath)} pnpm dev:dashboard`);
  }

  // Validate via the zero-dep validator; fail the process on any error.
  const { execFileSync } = require("node:child_process");
  try {
    const res = execFileSync("node", [VALIDATOR, outPath], { encoding: "utf8" });
    process.stdout.write(res);
    process.exit(0);
  } catch (e) {
    process.stdout.write((e.stdout || "").toString());
    process.stderr.write((e.stderr || "").toString());
    process.exit(e.status || 1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
