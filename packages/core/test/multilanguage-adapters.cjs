#!/usr/bin/env node
/*
 * M5 multi-language adapter smoke fixture.
 *
 * Proves runtime graph assembly can consume JS/TS, Python, and Go adapters while
 * keeping final findings empty and candidate signals runtime-only.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { validate } = require("../scripts/validate-graph.cjs");

async function main() {
  const { assessRepo } = await import("../runtime/engine.mjs");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "assess-multilang-"));
  try {
    fs.mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "src", "service.ts"), [
      "export function makeService() {",
      "  return { ok: true };",
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "src", "worker.py"), [
      "class Worker:",
      "    def run(self):",
      "        return True",
      "",
      "def start_worker():",
      "    return Worker().run()",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "src", "main.go"), [
      "package main",
      "",
      "func Start() bool {",
      "    return true",
      "}",
      "",
    ].join("\n"));

    const { graph, summary } = assessRepo({ repoRoot: fixtureRoot, commit: "fixture" });
    const verdict = validate(graph);
    assert.deepEqual(verdict.errors, []);
    assert.equal(graph.findings.length, 0);
    assert.equal(graph.artifact.finalFindingsSource, "agent_review_required");
    assert.ok(graph.project.languages.includes("TypeScript"));
    assert.ok(graph.project.languages.includes("Python"));
    assert.ok(graph.project.languages.includes("Go"));

    const adapterIds = new Set(graph.artifact.adapterRuns.map((run) => run.adapterId));
    assert.ok(adapterIds.has("javascript-typescript-v2"));
    assert.ok(adapterIds.has("python-regex-v1"));
    assert.ok(adapterIds.has("go-regex-v1"));
    assert.ok(graph.artifact.adapterRuns.every((run) => Array.isArray(run.limitations)));

    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    assert.ok(nodeIds.has("function:src/service.ts:makeService"));
    assert.ok(nodeIds.has("class:src/worker.py:Worker"));
    assert.ok(nodeIds.has("function:src/worker.py:start_worker"));
    assert.ok(nodeIds.has("function:src/main.go:Start"));
    assert.equal(summary.findings, 0);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("✓ multi-language adapter fixture passed");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
