# assess — Specification

> Status: v2.0.0 · authoritative spec. Code in `packages/` and the pipeline in
> `skills/assess/SKILL.md` implement this document. Where they disagree, this
> document is the intent and the code is the fact — reconcile toward this.

---

## 1. Purpose & positioning

**assess answers one question:** *“Where does this codebase fall short of what it
is supposed to be — and what did we fail to check?”*

It borrows the **mechanism** of Understand Anything (an AI converts source code
into a graph JSON that is rendered on an interactive dashboard) but changes the
**meaning** of every step:

- Understand Anything **describes**: the graph is a map of architecture so a
  human can *understand* the system.
- assess **judges**: the conversion runs an **assessment engine**, and the graph
  is a map of **gaps** between intent and code, with explicit **coverage** of
  what was and was not assessed.

assess is read-only. It never edits the target code.

### Why this is not just “UA with red nodes”
The deterministic graph UA produces is exactly the *fact layer* an assessment
needs. assess reuses that idea but adds three things UA does not have:
1. a **confirmed intent model** (the should-be) to judge against,
2. an **engine** that joins intent to facts and emits verdicts in three gap
   directions, and
3. a **coverage manifest** that makes the absence of judgment visible.

---

## 2. Glossary

| Term | Meaning |
|---|---|
| **Fact layer** | Deterministic code index (nodes + edges) derived only from source. Never trusts prose. |
| **Intent / should-be** | What the code is supposed to do, **confirmed by a human**. Hashed for drift detection. |
| **Capability** | A promised unit of behavior (e.g. “Payments”) that owns components. |
| **Gap** | A disagreement between intent and code, in one of three directions. |
| **Finding** | A single graded verdict with evidence, severity, and a fix. |
| **Coverage status** | Per-node record of whether it was `assessed` / `partial` / `not_assessed` / `coverage_insufficient`. |
| **Binding** | The commit SHA + intent-spec hash (+ span hashes) a verdict was made against. |
| **Evidence strength** | `verified` / `inferred` / `unverifiable` — caps how high severity may go. |

---

## 3. Functional spec — what assess DOES

### 3.1 Inputs
- A readable source tree at a known git commit.
- (Phase 3) Human confirmation of the intent model.
- Invocation flags (`/assess`, `intent`, `module <name>`, `quick`/`deep`,
  `alignment|correctness|quality`, `reconcile`, `report`).

### 3.2 Outputs (written to `.assessment/`)
| Artifact | Consumer | Contract |
|---|---|---|
| `assessment-graph.json` | the dashboard + tooling | §4 (validated before write) |
| `intent-spec.md` | humans + next run | the confirmed should-be, hashed |
| `report.md` | humans | ranked findings, grouped by direction |
| `findings/<id>.md` | humans | one finding with full evidence + binding |

### 3.3 The three gap directions (the engine’s job)
For **every area / every significant component**, the engine emits a verdict in
each applicable direction:

1. **intent \u2192 code** (catches *over-promising*)
   For each confirmed capability/process: `satisfied` | `partial` |
   `misaligned` | `missing`. A `missing` verdict **requires a missing-code
   proof**; unproven absence is reported as “not found,” not “missing.”
2. **code \u2192 intent** (catches *under-explaining*: dead code / scope creep)
   For each significant component: `justified` (maps to confirmed intent) or
   `unexplained` (no intent explains it).
3. **baseline \u2192 code** (catches *defects*, intent-independent)
   Correctness / security / quality violations that are wrong regardless of
   intent.

### 3.4 Severity — deterministic and capped
Severity is assigned by a rule, then **capped** so output never over-claims:
- `unverifiable` evidence → max P2; `inferred` without a 2nd verified fact → max P1.
- `LOW` confidence → max P3.
- `UNCONFIRMED` intent → max P2.
- Unproven absence (`not_found_in_index` / `coverage_insufficient`) → max P2.
- Security-sensitive path → floor P1 (applied last).

The set of caps applied is recorded on each finding’s `explanation`, so a reader
can see *why* a P0 rule became a P2 verdict.

### 3.5 Coverage — the honesty guarantee
- Phase 1 enumerates **every area**; that count is the denominator.
- **Every assessable node MUST carry a `coverageStatus`.** A node that cannot
  be judged is `not_assessed` **with a reason** — never omitted.
- The coverage manifest’s `byStatus` must sum to the assessable-node count
  (validator error otherwise), and every non-`assessed` scope is listed in
  `coverage.gaps`.
- Ideal run: `byStatus.assessed == totalNodes` and `gaps == []` (whole repo
  assessed). Anything less is shown, loudly, in the banner.

---

## 4. Data contract — `assessment-graph.json`

Authoritative types: `packages/core/src/types.ts` + `schema.ts`. Human summary:
`skills/assess/references/graph-schema.md`. Shape:

```jsonc
{
  "version": "2.0.0",
  "kind": "assessment",                 // discriminator; dashboard rejects others
  "binding": { assessedAtCommit, intentSpecHash, generated },
  "project": { name, languages, frameworks, description, analyzedAt, gitCommitHash },
  "intents":  [GraphNode],              // capability + intent nodes (the should-be)
  "nodes":    [GraphNode],              // fact-layer components + assessment overlay
  "edges":    [GraphEdge],              // fact + intent + 3 gap-direction edges
  "findings": [Finding],
  "areas":    [Area],                   // partitions, each with a coverage status
  "coverage": CoverageManifest,         // proves WHICH areas were assessed
  "summary":  AssessmentSummary
}
```

**Validation gate:** before any write, the graph must pass
`validateAssessmentGraph` (and the dependency-free `validate-graph.cjs`):
referential integrity, coverage completeness, and the honesty rules
(§3.4/§3.5). A failing gate blocks the run.

---

## 5. Pipeline spec (8 phases, I/O)

| Phase | Input | Output | Guarantee |
|---|---|---|---|
| 0 Pre-flight | repo, commit | scan roots, exclusions | refuse to fabricate if unreadable |
| 1 SCAN | source tree | areas + file inventory | every file maps to exactly one area |
| 2 INDEX | files | fact-layer nodes/edges + span hashes | facts only; prose untrusted |
| 3 INTENT-GATE | human input | confirmed intent-spec + hash | unconfirmed → capped severity |
| 4 ASSESS ENGINE | facts + intent | findings + gap edges | 3 directions; severity capped |
| 5 ASSEMBLE | engine output | the graph + coverage manifest | every node gets a status |
| 6 REVIEW | the graph | validated graph | honesty gate blocks bad writes |
| 7 SAVE | validated graph | `.assessment/*` | artifacts bound to commit + hash |

---

## 6. Dashboard spec

Three views over the same graph; a coverage **banner** sits above all of them
stating `X% assessed`, headline trust, and naming anything not assessed.

| View | Shows | Color means |
|---|---|---|
| **Coverage map** | every area + node | assessment status (`not_assessed` = loud red) |
| **Gap map** | intent side ↔ code side, joined by gap edges | edge = direction; node = worst severity |
| **Findings** | ranked verdict list | severity + evidence-strength badges |

Filters: gap direction, minimum severity, search, show/hide satisfied edges.
Clicking a node or finding cross-links the two.

---

## 7. Usefulness — who uses it, when, and what they get

### 7.1 Use cases
1. **Pre-release / pre-merge gate** — “Does the code actually do what we promised
   this release?” Run `/assess`; block on open P0/P1 in `intent\u2192code`.
2. **Inherited / legacy codebase audit** — “What is here that nobody can explain?”
   The `code\u2192intent` direction surfaces unexplained/dead code; the coverage map
   shows how much of it you have actually understood vs. not.
3. **Spec-vs-implementation review** — confirm intent once, then re-run on each
   change; `reconcile` reuses verdicts whose code only got reformatted and
   re-judges the rest.
4. **Security/correctness sweep** — run `correctness` to get only
   `baseline\u2192code` findings, with the security-sensitive floor applied.
5. **Onboarding honesty** — instead of a tour that implies you understand the
   system, the coverage map shows exactly which areas have NOT been assessed.

### 7.2 What makes the output trustworthy (and thus useful)
- Every verdict is **grounded** in a deterministic fact + evidence strength.
- The tool **cannot** claim a high severity on weak evidence (caps are enforced).
- The tool **cannot** silently skip code — unassessed areas are first-class output.
- Every verdict is **bound** to a commit + intent hash, so it is reproducible and
  drift is detectable.

### 7.3 Concrete example (shipped sample: payments-service)
The sample `assessment-graph.json` demonstrates all three directions:
- `intent\u2192code` **misaligned** (A-001): charge persists the idempotency key
  *after* mutating balance — P1, verified.
- `intent\u2192code` **missing/not-found** (A-002): no refund path in the index —
  capped to P2 because route coverage is only 70% (absence not proven).
- `code\u2192intent` **unexplained** (A-003): `applyDiscount()` maps to no confirmed
  intent — P2 against UNCONFIRMED.
- `baseline\u2192code` **violation** (C-001): await precedes balance mutation — P1,
  security floor.
- **Coverage**: 4/5 nodes assessed; `src/webhooks/handler.ts` is `not_assessed`
  (dynamic dispatch) and is named in the banner — nothing is hidden.

---

## 8. Guarantees & non-goals

**Guarantees**
1. Never edits the target code.
2. No assumed intent — confirmed or UNCONFIRMED (capped).
3. Every finding carries evidence + strength; severity respects the caps.
4. Absence claims require a missing-code proof.
5. Every scanned node gets a coverage status; gaps in coverage are shown.
6. Every finding is bound to a commit + intent-spec hash.
7. The graph is validated before it is written.

**Non-goals**
- Not a comprehension tour or architecture explainer (that is Understand Anything).
- Not an autofixer or refactoring bot.
- Not a linter replacement — baseline rules are a floor, not the point.
- Does not assume runtime/CI infrastructure (those VAC layers are out of scope for v2.0.0).
