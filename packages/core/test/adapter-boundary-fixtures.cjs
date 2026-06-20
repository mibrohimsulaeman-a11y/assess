#!/usr/bin/env node
/*
 * M3 adapter-boundary fixture.
 *
 * Proves the runtime JS/TS scanner now sits behind a language adapter boundary
 * while preserving deterministic file, symbol, import-edge, and test-file facts.
 */
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");

function sha256(source) {
  return "sha256:" + crypto.createHash("sha256").update(source, "utf8").digest("hex");
}

function normalizedFingerprint(source) {
  return "nfp:" + crypto.createHash("sha256").update(source.replace(/\s+/g, " ").trim(), "utf8").digest("hex");
}

function langOf(filePath) {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (["ts", "tsx", "mts", "cts"].includes(ext)) return "TypeScript";
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "JavaScript";
  return "Other";
}

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) out.push({ abs, rel, bytes: fs.statSync(abs).size });
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

async function main() {
  const { javascriptTypeScriptAdapter } = await import("../runtime/adapters/javascript.mjs");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "assess-adapter-fixture-"));
  try {
    fs.mkdirSync(path.join(fixtureRoot, "src"), { recursive: true });
    fs.writeFileSync(path.join(fixtureRoot, "src", "a.ts"), [
      "import { B } from './b';",
      "export function makeB() {",
      "  return new B();",
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "src", "b.js"), [
      "export class B {",
      "  value() { return 1; }",
      "}",
      "",
    ].join("\n"));
    fs.writeFileSync(path.join(fixtureRoot, "src", "a.test.ts"), "export function helper() { return true; }\n");
    fs.writeFileSync(path.join(fixtureRoot, "README.md"), "# ignored by JS/TS adapter\n");

    const result = javascriptTypeScriptAdapter.scanRepo({
      repoRoot: fixtureRoot,
      allFiles: walk(fixtureRoot),
      langOf,
      sourceSha256: sha256,
      normalizedFingerprint,
    });

    assert.equal(result.adapterId, "javascript-typescript-regex-v1");
    assert.deepEqual(result.languageIds, ["JavaScript", "TypeScript"]);
    assert.equal(result.assessedFiles.length, 3);
    assert.equal(result.indexedFileCount, 3);
    assert.ok(result.limitations.includes("scanner cannot resolve dynamic/computed/re-exported symbols"));

    const nodeIds = new Set(result.componentNodes.map((node) => node.id));
    assert.ok(nodeIds.has("file:src/a.ts"));
    assert.ok(nodeIds.has("file:src/b.js"));
    assert.ok(nodeIds.has("function:src/a.ts:makeB"));
    assert.ok(nodeIds.has("class:src/b.js:B"));

    const importEdge = result.factEdges.find((edge) => edge.id === "edge:imports:file:src/a.ts->file:src/b.js");
    assert.ok(importEdge, "relative import edge should be resolved by adapter");
    assert.equal(importEdge.evidence.fact, "src/a.ts imports ./b");

    const testFile = result.componentNodes.find((node) => node.id === "file:src/a.test.ts");
    assert.deepEqual(testFile.tags, ["test"]);

    const helperObservation = result.observations.find((obs) => obs.nodeId === "function:src/a.test.ts:helper");
    assert.ok(helperObservation, "test helper should still be indexed as a fact");
    assert.deepEqual(helperObservation.baselineViolations, [], "test symbols must not produce baseline violations");
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("✓ adapter boundary fixture passed");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
