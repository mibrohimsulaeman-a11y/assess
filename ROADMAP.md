# Roadmap

This roadmap is intentionally public and evidence-oriented. `assess` should not
claim product maturity before the corresponding checks exist.

## v0.1 — Public foundation

Goal: make the repository understandable, installable, and safe to inspect.

- [x] MIT license.
- [x] Public README with honest current status.
- [x] Zero-dependency graph validator.
- [x] Negative honesty-gate fixtures.
- [x] Dashboard sample with coverage, gap, and findings views.
- [x] Post-run dashboard concept and generated-graph loading path (`ASSESS_GRAPH`).
- [x] Zero-dependency headless assessment engine (`runtime/engine.mjs`).
- [x] Zero-dependency MCP server exposing the assessment boundary.
- [x] Claude Code plugin surfaces (commands, skills, agents, hooks).
- [x] Set plugin and package metadata to `mibrohimsulaeman-a11y/assess`.
- [ ] Add repository screenshots or a short demo video/GIF.
- [ ] Publish first GitHub release.

## v0.2 — MCP-backed plugin assessment runtime (P0)

Goal: a deterministic, executable assessment boundary the plugin/agent calls —
not a terminal-first CLI. The headline product is the plugin + MCP server.

- [x] `assess-server` MCP tools: `assess_repo`, `validate_graph`,
      `list_findings`, `explain_finding`, `export_report`.
- [x] Claude Code commands/skills: `/assess:assess`, `/assess:assess-pr`, `/assess:explain-finding`.
- [x] deterministic validator stays in `packages/core`.
- [x] minimal TS/JS scanner invoked by the engine/MCP server (not by a CLI).
- [x] dashboard reads the engine output.
- [x] tiny CLI shim (`assess-run.mjs`) for CI/debug only — never the headline.
- [ ] richer intent-spec authoring/confirmation flow.

## v0.3 — Scanner depth

Goal: stronger deterministic facts from real TypeScript/JavaScript repositories.

- [x] file inventory with generated/vendor/test classification;
- [x] import graph extraction (intra-repo edges);
- [x] function/class/component extraction;
- [x] route/API endpoint heuristics;
- [x] raw span hash + normalized fingerprint per symbol;
- [ ] AST-grade extraction (replace regex MVP) for fewer false negatives;
- [ ] test-to-source linking heuristics.

## v0.4 — Integrations

Goal: fit into agentic coding workflows.

- [ ] Claude Code plugin install path verified end to end;
- [ ] GitHub Action for PR assessment summaries;
- [ ] import adapter for existing knowledge graphs;
- [ ] import adapter for coverage reports;
- [ ] import adapter for static-analysis findings.

## v0.5 — Evidence-grade assessment

Goal: make absence and trust claims hard to fake accidentally.

- [ ] coverage-bounded missing-code proof across scanner output;
- [ ] stale graph reconciliation by commit + fingerprint;
- [ ] finding baseline/debt workflow;
- [ ] trend diff between assessment runs;
- [ ] exportable audit bundle.

## v1.0 — Stable public contract

Goal: stable schema, MCP tool contract, dashboard, and plugin workflow.

- [ ] stable graph schema with migration policy;
- [ ] public docs site;
- [ ] representative fixture repos;
- [ ] performance baseline for medium repositories;
- [ ] security review of dashboard graph rendering;
- [ ] full CI with tests, build, and dependency audit.
