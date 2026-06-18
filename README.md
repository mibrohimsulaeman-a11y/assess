# assess

**Intent-vs-code assessment for agentic software teams.**

`assess` judges a repository against what it is supposed to do, then emits an
`assessment-graph.json` that can be rendered as a dashboard. The graph is not a
code tour. It is a gap map: what is implemented, what is missing, what is
unexplained, what violates the baseline, and what was not assessed.

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
facts into evidence-bound findings.

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
read repo -> build index -> generate assessment graph -> validate evidence -> return findings
```

## Current status

This repository is an early but **executable** open-source implementation:

- `@assess/core`: graph contract, fact-layer primitives, assessment utilities,
  assembly, and validation.
- **`packages/core/runtime/engine.mjs`**: a zero-dependency headless assessment
  engine — it scans a real TS/JS repo, builds the index, runs all three gap
  directions, assembles and validates an `assessment-graph.json`. Runs with
  plain `node`, before anything is installed.
- **`plugins/assess/mcp/assess-server.mjs`**: a zero-dependency MCP server
  (JSON-RPC over stdio) exposing `assess_repo`, `validate_graph`,
  `list_findings`, `explain_finding`, `export_report`.
- **`plugins/assess/`**: Claude Code plugin surfaces — commands (`/assess:assess`,
  `/assess:assess-pr`, `/assess:explain-finding`), skills, agents, and hooks.
- `@assess/dashboard`: a React/ReactFlow dashboard (coverage map / gap map /
  findings) for the assessment graph.
- Zero-dependency honesty-gate fixtures proving the validator on sample graphs.

Honest limitation: the TS/JS scanner is a deterministic MVP (regex + brace
matching), and intent-mode polish, more baseline rules, and a GitHub Action are
roadmap work. The engine and MCP server are proven to run end-to-end with
`node`; full workspace build is validated through the pnpm build pipeline when dependencies are installed.

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
    core/                           # @assess/core — fact layer + assessment engine
      src/
        fact-layer/                 # scan, index builder, fingerprinting
        intent/                     # confirmed intent spec + binding hash
        assess/                     # gap engine, missing-code proof, severity, coverage
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

When `ASSESS_GRAPH` is set, the dev server exposes that generated graph as `/__assessment_graph__`, so the dashboard shows the exact artifact emitted by the assessment process. See [`docs/DASHBOARD_CONCEPT.md`](./docs/DASHBOARD_CONCEPT.md).

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

The skill contract is present in `skills/assess/SKILL.md`. The full local CLI
and production scanner are tracked in `ROADMAP.md`.

---

## Dashboard views

The dashboard is the post-run cockpit for the generated `assessment-graph.json`. It starts with a run summary (headline, commit, trust, coverage percentage, finding count, and severity split), then renders the same graph three ways:

- **Coverage map** — every area and node by assessment status.
- **Gap map** — intent-side and code-side nodes connected by gap edges.
- **Findings** — ranked evidence-bound verdicts with severity and proof status.

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

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md). The next critical milestone is a real
end-to-end demo:

```text
assess run --repo . --intent intent-spec.md --out .assessment/
```

That demo must read a real TS/JS repo, emit a valid graph, open in the dashboard,
and prove at least one missing implementation with bounded evidence.

---

## Contributing

Contributions are welcome while the project is still early. Start with:

- [`CONTRIBUTING.md`](./CONTRIBUTING.md)
- [`ROADMAP.md`](./ROADMAP.md)
- [`docs/OPEN_SOURCE_LAUNCH.md`](./docs/OPEN_SOURCE_LAUNCH.md)

Good first contributions are scanner fixtures, graph validator cases, dashboard
UX improvements, and small docs fixes.

---

## License

MIT. See [`LICENSE.md`](./LICENSE.md).

Repository: `https://github.com/mibrohimsulaeman-a11y/assess`.
