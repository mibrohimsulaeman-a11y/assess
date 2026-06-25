#!/usr/bin/env node
/*
 * M6 framework pack fixture.
 *
 * Proves framework packs sit after language adapters, convert supported literal
 * framework facts into endpoint nodes + routes edges, and preserve runtime-only
 * candidate/final finding semantics.
 */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { validate } = require("../scripts/validate-graph.cjs");

async function main() {
  const { assessRepo } = await import("../runtime/engine.mjs");
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "assess-framework-packs-"));
  try {
    writeFixtureRepo(fixtureRoot);
    const { graph, summary } = assessRepo({ repoRoot: fixtureRoot, commit: "fixture" });
    const verdict = validate(graph);
    assert.deepEqual(verdict.errors, []);
    assert.equal(graph.findings.length, 0);
    assert.equal(graph.artifact.finalFindingsSource, "agent_review_required");

    const endpointNodes = graph.nodes.filter((node) => node.type === "endpoint");
    const routeEdges = graph.edges.filter((edge) => edge.type === "routes");
    assert.ok(endpointNodes.length >= 8, `expected at least 8 endpoint nodes, got ${endpointNodes.length}`);
    assert.ok(routeEdges.length >= 8, `expected at least 8 route edges, got ${routeEdges.length}`);
    assert.ok(endpointNodes.every((node) => node.assessment?.coverageStatus), "endpoint nodes must be stamped with assessment coverage");

    const nodeIds = new Set(graph.nodes.map((node) => node.id));
    assert.ok(nodeIds.has("endpoint:express:src/server.ts:get:/health"));
    assert.ok(nodeIds.has("endpoint:express:src/server.ts:post:/users"));
    assert.ok(nodeIds.has("endpoint:nextjs:app/api/health/route.ts:get:/api/health"));
    assert.ok(nodeIds.has("endpoint:nextjs:pages/api/users.ts:all:/api/users"));
    assert.ok(nodeIds.has("endpoint:fastapi:src/api.py:get:/ready"));
    assert.ok(nodeIds.has("endpoint:fastapi:src/api.py:post:/items"));
    assert.ok(nodeIds.has("endpoint:go-http:cmd/server/main.go:all:/metrics"));
    assert.ok(nodeIds.has("endpoint:go-http:cmd/server/main.go:get:/widgets"));

    const frameworkPackIds = new Set((graph.artifact.frameworkRuns || []).map((run) => run.packId));
    assert.ok(frameworkPackIds.has("express-v1"));
    assert.ok(frameworkPackIds.has("nextjs-v1"));
    assert.ok(frameworkPackIds.has("fastapi-v1"));
    assert.ok(frameworkPackIds.has("go-http-v1"));
    assert.ok(graph.artifact.frameworkRuns.every((run) => run.detected === true));
    assert.ok(graph.artifact.frameworkRuns.every((run) => run.endpointNodeCount > 0));
    assert.ok(graph.artifact.frameworkRuns.every((run) => Array.isArray(run.limitations) && run.limitations.length > 0));

    const adapterIds = new Set(graph.artifact.adapterRuns.map((run) => run.adapterId));
    assert.ok(adapterIds.has("javascript-typescript-v2"));
    assert.ok(adapterIds.has("python-regex-v1"));
    assert.ok(adapterIds.has("go-regex-v1"));
    assert.equal(summary.findings, 0);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
  console.log("✓ framework pack fixture passed");
}

function writeFixtureRepo(root) {
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "app", "api", "health"), { recursive: true });
  fs.mkdirSync(path.join(root, "pages", "api"), { recursive: true });
  fs.mkdirSync(path.join(root, "cmd", "server"), { recursive: true });

  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({
    dependencies: { express: "^4.18.0", next: "^14.0.0" },
  }, null, 2));
  fs.writeFileSync(path.join(root, "requirements.txt"), "fastapi==0.115.0\n");

  fs.writeFileSync(path.join(root, "src", "server.ts"), [
    "import express from 'express';",
    "const app = express();",
    "const router = express.Router();",
    "app.get('/health', health);",
    "router.post('/users', createUser);",
    "export function health(req: unknown, res: { json: (body: unknown) => void }) {",
    "  res.json({ ok: true });",
    "}",
    "export function createUser(req: unknown, res: { json: (body: unknown) => void }) {",
    "  res.json({ id: 'u1' });",
    "}",
    "",
  ].join("\n"));

  fs.writeFileSync(path.join(root, "app", "api", "health", "route.ts"), [
    "export async function GET() {",
    "  return Response.json({ ok: true });",
    "}",
    "",
  ].join("\n"));

  fs.writeFileSync(path.join(root, "pages", "api", "users.ts"), [
    "export default function handler(req: unknown, res: { status: (code: number) => { json: (body: unknown) => void } }) {",
    "  res.status(200).json([]);",
    "}",
    "",
  ].join("\n"));

  fs.writeFileSync(path.join(root, "src", "api.py"), [
    "from fastapi import FastAPI, APIRouter",
    "app = FastAPI()",
    "router = APIRouter()",
    "",
    "@app.get('/ready')",
    "def ready():",
    "    return {'ok': True}",
    "",
    "@router.post('/items')",
    "async def create_item():",
    "    return {'id': 'i1'}",
    "",
  ].join("\n"));

  fs.writeFileSync(path.join(root, "cmd", "server", "main.go"), [
    "package main",
    "",
    "import \"net/http\"",
    "",
    "func main() {",
    "    http.HandleFunc(\"/metrics\", Metrics)",
    "    r.Get(\"/widgets\", ListWidgets)",
    "}",
    "",
    "func Metrics(w http.ResponseWriter, r *http.Request) {",
    "    w.WriteHeader(http.StatusOK)",
    "}",
    "",
    "func ListWidgets(w http.ResponseWriter, r *http.Request) {",
    "    w.WriteHeader(http.StatusOK)",
    "}",
    "",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
