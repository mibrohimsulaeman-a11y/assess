---
name: assess
version: 2.0.0
description: >-
  Judge a codebase against what it SHOULD be by separating deterministic facts
  from semantic judgment. Runtime emits candidateSignals; an agent/human review
  pass promotes only high-quality, evidence-bound items into final findings and
  semantic assessment nodes. It never edits your code.
---

# assess

**assess is not “understand-anything for judgment” in spirit only — it reuses the
same idea (turn source into a graph rendered on a dashboard) but changes the
MEANING of every step.** Understand Anything *describes* a codebase. assess
*judges* it only after a semantic review pass: the runtime converts source into
facts and `candidateSignals`; an agent/human reviewer promotes only high-quality,
evidence-bound items into final `findings` and `assessmentNodes`.

| | Understand Anything | assess |
|---|---|---|
| Graph `kind` | `codebase` / `knowledge` | `assessment` |
| Goal of the graph | help you understand | show you the gaps |
| Node overlay | summary, tags | coverage status, ownership, candidate signals, readiness |
| Edges | structural / behavioral | + runtime candidate gap-signal edges |
| Headline | “here is the architecture” | “runtime evidence + what agent review has actually promoted” |

The conversion is an assessment, and **coverage is explicit**: every area that
exists should be assessed, and anything that was not assessed is named in the
graph (never silently dropped).

---

## What gets produced

Every run writes to `.assessment/`:

- **`assessment-graph.json`** — runtime graph from the deterministic engine. It
  contains fact nodes/edges and `candidateSignals`, but final `findings` stay
  empty until semantic review. Treat this as internal evidence substrate.
- **`review.decisions.json`** — explicit audit trail written after source review;
  one decision per candidate signal (`accept`, `reject`, `needs_more_evidence`).
- **`assessment-graph.reviewed.json`** — runtime graph plus applied review
  decisions. This is the first artifact eligible for dashboard/report display.
- `intent-spec.md` — the confirmed should-be model (hashed into every finding).
- `report.md` — the human-readable findings report, only from a reviewed graph.
- `findings/` — one file per reviewed finding with full evidence + binding.

The graph drives the `@assess/dashboard` review cockpit. It shows readiness
(`runtime_only`, `partial_review`, `reviewed_ready`), candidate review queues,
evidence/counter-evidence detail, final-finding linkage, and fact-layer
drilldowns. Runtime candidate signals are never presented as final findings.

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

### Phase 4 — DETERMINISTIC SIGNAL ENGINE (candidate signals, not findings)
`core/assess/gap-engine.ts` / `runtime/engine.mjs`. For **every area / every component**, join intent
to fact and emit a `candidateSignal`, not a final verdict:

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

### Phase 5 — AGENT SEMANTIC REVIEW DECISIONS
The agent reads candidate signals, inspects evidence refs, traces workflows,
checks counter-evidence, classifies intent lifecycle (`observed` / `inferred` /
`proposed` / `confirmed` / `rejected`), then writes `.assessment/<run-id>/review.decisions.json`.

Each candidate must receive exactly one decision:

| Decision | Meaning | Output |
|---|---|---|
| `accept` | Candidate is valid after semantic review | create final finding + semantic node linkage |
| `reject` | Candidate is noisy / not semantically actionable | mark rejected; no final finding |
| `needs_more_evidence` | Reviewer cannot decide yet | strict apply fails; dashboard/report remain blocked |

Store only auditable review summaries: `rationale`, concise `reasoningSummary`,
`evidenceRefs`, `counterEvidenceChecked`, and `openQuestions`. Do not store
private reasoning traces.

### Phase 6 — APPLY DECISIONS + HONESTY GATE
`core/review/apply-review-decisions.ts` + `runtime/review-run.mjs` +
`validate-graph.cjs`. Apply runtime graph + `review.decisions.json` into a
reviewed graph. Enforce referential integrity, coverage completeness, no pending
candidates, final-finding source, semantic-node linkage, counter-evidence, and
evidence refs. Errors block the write.

### Phase 7 — SAVE / PRESENTATION GATE
Write `.assessment/assessment-graph.reviewed.json` after validation. Do not
present dashboard/report while `artifact.finalFindingsSource` is
`agent_review_required` or any candidate signal remains `needs_agent_review`.

Only after semantic review is complete — normally after reading the relevant/full
source, reviewing every candidate signal, and promoting/rejecting them — may the
agent present the dashboard command or report.

---

## Invocation

- `/assess:assess` — full run, all areas → runtime graph, review decisions, reviewed graph, then report
- `quick` / `deep` — tune index depth (deep raises required coverage for absence proofs)
- `module <name>` — assess one area (the rest is marked `not_assessed` with reason, so coverage stays honest)
- `intent` — stop after INTENT-GATE to confirm the should-be model
- `alignment` | `correctness` | `quality` — run a subset of the engine
- `reconcile` — re-bind a prior graph to the current commit; reuse verdicts whose `normalized_fingerprint` is unchanged, re-judge the rest
- `review init` — create `review.decisions.json` template from a runtime graph
- `review apply` — apply decisions into `assessment-graph.reviewed.json`
- `review validate` — validate the reviewed graph before dashboard/report
- `report` — regenerate `report.md` from a reviewed graph

---

## Hard rules

1. Never edit the target code. assess only reads and reports.
2. No intent is assumed — it is confirmed (Phase 3) or treated as UNCONFIRMED (cap P2).
3. Every finding carries evidence + strength; severity respects the caps.
4. An absence claim (`missing` / dead code) requires a missing-code proof.
5. Every scanned node gets a coverage status — unassessed areas are shown, not hidden.
6. Every finding is bound to a commit + intent-spec hash (+ span hashes when cited).
7. The graph is validated before it is written; a failing honesty gate blocks the run.
8. The dashboard is a review cockpit: it must show readiness state, candidate queues, evidence detail, and linkage before any graph looks user-facing.
9. Runtime `candidateSignals` are never final findings until promoted by agent/human semantic review.
10. Do not present the dashboard while `finalFindingsSource` is `agent_review_required`; use it only as an internal preview until semantic review is complete.
11. Do not show or serve dashboard/report from a runtime-only graph. Only show dashboard/report after review decisions are applied and reviewed graph validation passes.
12. `candidateSignals` are not final findings; unresolved `needs_more_evidence` decisions must block presentation.

See `references/` for the rubric, intent elicitation, semantic review workflow,
the graph schema, and the report template; see `examples/` for sample artifacts.
