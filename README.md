# assess

**Intent-vs-code assessment for agentic software teams.**

`assess` judges a repository against what it is supposed to do, then emits an
`assessment-graph.json` that can be rendered as a dashboard. The graph is not a
code tour. It is a semantic assessment cockpit: runtime facts and candidate
signals are evidence substrate, while final findings and semantic nodes must be
produced by an agent/human review pass.

> Knowledge-graph tools help you understand a codebase. `assess` helps you
> decide whether the codebase can honestly claim that it satisfies its intent.

`assess` is read-only. It never edits the target repository.

---

## Why this exists

AI coding agents can create a large amount of code quickly. That shifts the
bottleneck from writing code to verifying claims about code:

- Does the implementation match the confirmed intent?
- Is an expected behavior missing, or merely not found with enough coverage?
- Which significant code has no product intent behind it?
- Which quality/security/reliability baseline rules are violated?
- Which repo areas were not assessed and must not be silently treated as clean?

`assess` is designed as an assessment layer. It can complement comprehension
systems, PR reviewers, static analyzers, and coverage tools by turning their
facts into evidence-bound candidate signals, then giving an agent/human reviewer a disciplined promotion path into final findings.

---

## How you use it (plugin-first)

`assess` is packaged as a **Claude Code / tool-agent plugin**, not a CLI you type
in a terminal. The product surface is the plugin and its portable **MCP server**;
the terminal shim is for CI/debug only.

Claude Code plugin commands are namespaced. In a plugin install, the public
entrypoints are `/assess:assess`, `/assess:assess-pr`, and
`/assess:explain-finding`. A standalone project-local skill may still choose a
short `/assess` alias, but the distributed OSS plugin should document the
namespaced form.

```text
Primary product:  Claude Code / tool-agent plugin  (/assess:assess, /assess:assess-pr, /assess:explain-finding)
Core runtime:     deterministic assessment engine + validator + scanner
Interop surface:  MCP server  (assess_repo, validate_graph, list_findings,
                               explain_finding, export_report)
Optional:         tiny CLI shim for CI/debug only (assess-run.mjs)
```

The agent never judges your code freely. It calls the deterministic boundary:

```text
read repo -> build fact index -> emit candidate signals -> agent semantic review -> final findings
```

## Current status

This repository is an early but **executable** open-source implementation. The
source of truth for actual assessment runs is the zero-dependency runtime, not
the typed helper modules:

- `@assess/core`: semantic graph contract, schemas, validator, fact-layer
  primitives, and typed reference helpers. It is not the production
  scanner/runtime pipeline by itself.
- **`packages/core/runtime/engine.mjs`**: the executable headless fact-layer
  engine — it scans a real TS/JS repo, builds the deterministic index, emits
  `candidateSignals`, assembles a semantic assessment shell, and validates it.
  It does **not** create final findings. Runs with plain `node`, before anything
  is installed.
- **`plugins/assess/mcp/assess-server.mjs`**: a zero-dependency MCP server
  (JSON-RPC over stdio) exposing `assess_repo`, `validate_graph`,
  `list_findings`, `explain_finding`, `export_report`.
- **`plugins/assess/`**: Claude Code plugin surfaces — commands (`/assess:assess`,
  `/assess:assess-pr`, `/assess:explain-finding`), skills, agents, and hooks.
- `@assess/dashboard`: a React/ReactFlow dashboard whose default view is the
  semantic assessment layer; fact coverage and runtime gap signals are drilldown
  views.
- Zero-dependency honesty-gate fixtures proving the validator on sample graphs.

Honest limitation: the TS/JS scanner is a deterministic MVP (regex + brace
matching). It does not yet implement a real AST/call graph, broad route parsing,
or behavioral partial/misaligned analysis. Runtime output is intentionally
candidate-only: `findings` remain empty until an agent/human semantic review
promotes a signal with evidence refs, counter-evidence checks, and a reasoning
summary. The engine and MCP server are proven to run end-to-end with `node`; full
workspace build is validated through the pnpm build pipeline when dependencies
are installed.

---

## Monorepo layout

```text
assess/
  .claude-plugin/plugin.json        # plugin manifest: commands, agents, skills, hooks, mcpServers
  plugins/assess/                   # Claude Code plugin surfaces
    commands/                       # /assess:assess, /assess:assess-pr, /assess:explain-finding
    skills/                         # assess-pr, explain-finding skill contracts
    agents/                         # assessment-reviewer, intent-gap-analyst
    hooks/                          # pre-commit-assess, post-edit-assess
    mcp/assess-server.mjs           # zero-dep MCP server (the portable boundary)
  skills/assess/                    # core /assess:assess workflow contract + references
  packages/
    core/                           # @assess/core — contracts + typed reference helpers
      src/
        fact-layer/                 # scan/index/fingerprint helper modules
        intent/                     # confirmed intent spec + binding hash
        assess/                     # typed gap helpers, missing-code proof, severity, coverage
        overlay/                    # assemble + validate honesty gates
      runtime/engine.mjs            # zero-dep headless engine (scan -> graph -> validate)
      runtime/assess-run.mjs        # optional CLI shim (CI/debug only)
      scripts/validate-graph.cjs    # dependency-free graph validator
      test/run-fixtures.cjs         # zero-dep negative fixture suite
    dashboard/                      # @assess/dashboard — React + ReactFlow gap map
      src/graph/                    # CoverageMapView, GapGraphView, FindingsView
      public/assessment-graph.json  # runnable sample graph; generated runs can be served with ASSESS_GRAPH
  examples/intent/                  # sample CONFIRMED intent spec for intent-bound mode
```

---

## Assessment model

`assess` joins three sources:

1. **Confirmed intent** — the should-be model.
2. **Deterministic facts** — scanned files, indexed nodes, edges, spans, hashes.
3. **Engineering baseline** — intent-independent quality/security/reliability rules.

It emits findings in three directions:

| Direction | Question | Typical finding |
|---|---|---|
| `intent → code` | Was a promised behavior implemented? | missing, partial, misaligned |
| `code → intent` | Does significant code have a justified purpose? | orphan, dead code, scope creep |
| `baseline → code` | Does code violate engineering policy? | security, reliability, maintainability |

The core rule: a finding must not claim more than its evidence supports.

The runtime currently emits missing, unexplained, and baseline-violation
**candidate signals** from deterministic TS/JS indexing. The typed helper API
still names `partial` and `misaligned` verdict shapes because the graph contract
supports them, but the runtime does not claim behavioral partial/misaligned
detection until stronger analysis exists. Final findings are agent/human-review
artifacts only.

---

## Honesty guarantees

1. Every assessable node gets a coverage status.
2. Unassessed areas are visible, not hidden.
3. Absence claims require a missing-code proof.
4. Unproven absence is not allowed to become a P0/P1 finding.
5. Unverifiable evidence is capped.
6. P0 findings cannot be made against unconfirmed intent.
7. Graph referential integrity is validated before publication.
8. The sample validator runs with plain `node`, before dependencies are installed.

---

## Quick start

Validate the sample graph and honesty fixtures without installing dependencies:

```bash
node packages/core/test/run-fixtures.cjs
node packages/core/scripts/validate-graph.cjs packages/dashboard/public/assessment-graph.json
```

Run the headless engine against a real repo (no install needed), in both modes:

```bash
# baseline-only (no confirmed intent): honest "partial" coverage
node packages/core/runtime/assess-run.mjs --repo packages/core/src --out .assessment

# intent-bound: three gap directions, evidence-bound findings
node packages/core/runtime/assess-run.mjs \
  --repo packages/core/src \
  --intent examples/intent/assess-core.intent.json \
  --out .assessment
```

Install as a Claude Code plugin to give your coding agent an evidence-bound
assessment workflow (`/assess:assess`, `/assess:assess-pr`, `/assess:explain-finding`), backed by the
`assess` MCP server.

Install dependencies and run the dashboard with the bundled sample graph:

```bash
pnpm install
pnpm validate:sample
pnpm dev:dashboard
```

Open the dashboard against a graph produced by a real assessment run:

```bash
node packages/core/runtime/assess-run.mjs --repo packages/core/src --out .assessment
ASSESS_GRAPH="$(pwd)/.assessment/assessment-graph.json" pnpm dev:dashboard
```

When `ASSESS_GRAPH` is set, the dev server exposes that generated graph as `/__assessment_graph__`, so the dashboard shows the exact artifact emitted by the assessment process.

Build all packages:

```bash
pnpm build
```

---

## Claude Code skill

The intended Claude Code entrypoint is:

```text
/assess:assess
```

Related modes planned by the skill contract:

```text
/assess:assess intent
/assess:assess module payments
/assess:assess reconcile
/assess:assess report
```

The skill contract is present in `skills/assess/SKILL.md`.

---

## Dashboard views

The dashboard is the post-run cockpit for the generated `assessment-graph.json`.
It starts with the semantic layer, then exposes deterministic evidence as
drilldown:

- **Semantic assessment** — curated semantic nodes and final findings. Runtime-only runs show why agent review is still required.
- **Final findings** — agent/human-reviewed verdicts only.
- **Fact gap signals** — deterministic `candidateSignals`; useful evidence, not final findings.
- **Fact coverage** — every area and node by deterministic coverage status.

---

## Public positioning

`assess` is not trying to replace codebase comprehension tools or AI PR review
bots. The intended role is narrower:

```text
comprehension graph / static facts / coverage / PR context
                      ↓
             assess judgment layer
                      ↓
       evidence-bound assessment graph + report
```

Use it when the question is not merely "what is in this repo?" but "what can we
honestly claim about this repo?"

---


## Contributing

Contributions are welcome while the project is still early. Start with [`CONTRIBUTING.md`](./.github/CONTRIBUTING.md).

Good first contributions are scanner fixtures, graph validator cases, dashboard UX improvements, and small docs fixes.

---

## License

MIT. See [`LICENSE.md`](./LICENSE.md).

Repository: `https://github.com/mibrohimsulaeman-a11y/assess`.
