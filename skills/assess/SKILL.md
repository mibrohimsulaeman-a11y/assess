---
name: assess
version: 2.0.0
description: >-
  Judge a codebase against what it SHOULD be. assess derives confirmed intent,
  runs the assessment engine across EVERY area, and emits a gap-graph
  (.assessment/assessment-graph.json) rendered on an interactive dashboard. The
  graph maps gaps — intent\u2192code, code\u2192intent, and baseline\u2192code — not a
  comprehension tour. It never edits your code.
---

# assess

**assess is not “understand-anything for judgment” in spirit only — it reuses the
same idea (turn source into a graph rendered on a dashboard) but changes the
MEANING of every step.** Understand Anything *describes* a codebase. assess
*judges* it: the pipeline converts source code into an `assessment-graph.json`
by running the **assessment engine**, and the graph the dashboard shows maps
**gaps**, not architecture.

| | Understand Anything | assess |
|---|---|---|
| Graph `kind` | `codebase` / `knowledge` | `assessment` |
| Goal of the graph | help you understand | show you the gaps |
| Node overlay | summary, tags | coverage status, ownership, findings, readiness |
| Edges | structural / behavioral | + the three gap directions |
| Headline | “here is the architecture” | “X% assessed; here is what is wrong and what was NOT assessed” |

The conversion is an assessment, and **coverage is explicit**: every area that
exists should be assessed, and anything that was not assessed is named in the
graph (never silently dropped).

---

## What gets produced

Every run writes to `.assessment/`:

- **`assessment-graph.json`** — the machine artifact the dashboard renders.
  Validated by `@assess/core` (`validateAssessmentGraph`) and the dependency-free
  `validate-graph.cjs` before it is written.
- `intent-spec.md` — the confirmed should-be model (hashed into every finding).
- `report.md` — the human-readable findings report.
- `findings/` — one file per finding with full evidence + binding.

The graph drives three dashboard views (`@assess/dashboard`): **Coverage map**,
**Gap map**, **Findings**.

---

## The pipeline (8 phases)

The phases mirror Understand Anything’s scan→analyze→assemble shape, but two
phases are replaced by the things that make this an assessment: **INTENT-GATE**
and **ASSESS ENGINE**. UA’s architecture/tour phases are dropped — assess does
not produce a guided tour.

### Phase 0 — Pre-flight
Resolve the git commit, the scan roots, and exclusions (vendored/generated).
Refuse to fabricate: if the repo is unavailable, stop.

### Phase 1 — SCAN (enumerate every area)
`core/fact-layer/scan.ts`. Inventory the whole tree and partition it into
**areas** (default: top-level source dirs). Every non-excluded file maps to
exactly one area. **This is what makes whole-repo coverage measurable** — the
denominator is fixed here, before any judging.

### Phase 2 — INDEX (the deterministic fact layer)
`core/fact-layer/index-builder.ts` + `fingerprint.ts`. Build component nodes
(code + non-code) and structural edges from source only. Stamp each cited span
with `span_sha256` + `normalized_fingerprint`. **Stored prose is never trusted**
(VAC §6) — only facts derived here.

### Phase 3 — INTENT-GATE (the should-be)
`core/intent/intent-spec.ts` + `references/intent-elicitation.md`. Elicit intent
and have the user **CONFIRM** it. Unconfirmed intent caps severity at P2.
Hash the confirmed spec; the hash is stamped into every finding’s binding so a
later run can tell whether a verdict was made against the same intent.

### Phase 4 — ASSESS ENGINE (the three gap directions)
`core/assess/gap-engine.ts`. For **every area / every component**, join intent
to fact and emit a verdict:

1. **intent\u2192code** — each promised capability: implemented / partial / misaligned
   / missing? Missing requires a **missing-code proof** (`missing-code-proof.ts`);
   unproven absence is “not found,” not “missing,” and is capped.
2. **code\u2192intent** — each significant component: justified by a confirmed intent,
   or **unexplained** (dead code / scope creep)?
3. **baseline\u2192code** — correctness/security/quality violations, intent-independent.

Severity is assigned by rule then **capped by evidence strength, confidence,
intent-confirmation, and absence-proof** (`severity.ts`). Nothing claims stronger
than its weakest evidence supports.

**Coverage rule:** every scanned node MUST receive a `coverageStatus`
(`assessed` / `partial` / `not_assessed` / `coverage_insufficient`). If a node
cannot be judged, mark it `not_assessed` with a reason — do not skip it.

### Phase 5 — ASSEMBLE
`core/overlay/assemble.ts`. Fold fact layer + intent + engine output into one
graph: stamp each node’s assessment overlay (coverage, ownership, worst severity,
readiness), roll findings up to areas, and build the **coverage manifest**
(`coverage.ts`) that names every area/node not fully assessed.

### Phase 6 — REVIEW (honesty gate)
`core/overlay/validate.ts` + `validate-graph.cjs`. Enforce referential
integrity, coverage completeness (manifest tallies every assessable node), and
the honesty rules (absence needs a proof; no P0 on unverifiable or UNCONFIRMED).
Errors block the write.

### Phase 7 — SAVE
Write `.assessment/assessment-graph.json` + `report.md` + `findings/`. Open the
dashboard with `pnpm dev:dashboard`.

---

## Invocation

- `/assess:assess` — full run, all areas → graph + report
- `quick` / `deep` — tune index depth (deep raises required coverage for absence proofs)
- `module <name>` — assess one area (the rest is marked `not_assessed` with reason, so coverage stays honest)
- `intent` — stop after INTENT-GATE to confirm the should-be model
- `alignment` | `correctness` | `quality` — run a subset of the engine
- `reconcile` — re-bind a prior graph to the current commit; reuse verdicts whose `normalized_fingerprint` is unchanged, re-judge the rest
- `report` — regenerate `report.md` from an existing graph

---

## Hard rules

1. Never edit the target code. assess only reads and reports.
2. No intent is assumed — it is confirmed (Phase 3) or treated as UNCONFIRMED (cap P2).
3. Every finding carries evidence + strength; severity respects the caps.
4. An absence claim (`missing` / dead code) requires a missing-code proof.
5. Every scanned node gets a coverage status — unassessed areas are shown, not hidden.
6. Every finding is bound to a commit + intent-spec hash (+ span hashes when cited).
7. The graph is validated before it is written; a failing honesty gate blocks the run.
8. The dashboard shows gaps and coverage — never a “everything looks fine” tour.

See `references/` for the rubric, intent elicitation, the graph schema, and the
report template; see `examples/` for a sample finding, a graph payload, and an
implementation plan.
