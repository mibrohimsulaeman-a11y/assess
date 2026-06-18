# Assessment Rubric

What to judge, how to ground it, and how to grade severity. Every finding — from every category, every subagent — must reduce to: a claim, a deterministic fact behind it, an evidence strength, a severity by rule, and a recommendation. Adapt depth to repo size.

**The grounding rule overrides everything here:** a finding exists only if a deterministic fact supports it. “This probably has a race condition somewhere” is not a finding; “`charge.rs:40-78` mutates `balance` after an `await` with no lock (call graph: on checkout critical path), 0% coverage” is.

---

## The three gap directions

Assessment is a join over three sources of truth, producing findings along three directions. Each finding is tagged by direction and by category.

| Direction | Question | Finding types |
|---|---|---|
| **intent → code** | Does every intended process have an implementation? | missing, partial, misalignment |
| **code → intent** | Does every significant piece of code have an intent that justifies it? | unexplained (dead code, orphan, scope creep) |
| **baseline → code** | Does the implementation meet the engineering baseline, regardless of intent? | correctness, quality |

The first two need confirmed intent (Hard Rule 5). The third does not.

---

## The three categories

### A. Alignment — does the code match the intent? (intent↔code directions)

Judged against the **confirmed intent spec**. The category a descriptive tool cannot produce, and the highest-value one for a messy codebase.

- **missing** (intent → code): an intended process has no code path. **Requires a missing-code proof (below).** Evidence: the intent entry + a proven absence, not just “I didn't see it.”
- **partial** (intent → code): a path exists but doesn't cover the intended behavior (happy path only, an intended branch absent).
- **unexplained** (code → intent): significant code with no intent that justifies it — dead code, orphan modules, scope creep. Evidence: orphan/dead-code fact (no inbound edges in the relation graph) **plus a missing-code proof** that no intent maps to it.
- **misalignment** (both, but different): a path exists for an intended process but behaves differently than intended, including **name-vs-behavior** mismatches (`validateUser()` that validates nothing). Evidence: the intent entry + the cited code that contradicts it.

### B. Correctness — is the code right on its own terms? (baseline → code)

Judged against the **engineering baseline**; needs no intent.

- Error handling: swallowed exceptions, empty catch blocks, missing error states.
- Async hazards: unawaited promises, race conditions on shared state, missing cancellation/cleanup.
- Null/undefined flows, boundary conditions (off-by-one, empty-collection, timezone, overflow).
- State machines: unhandled enum branches, impossible states representable in types.
- Concurrency & idempotency: check-then-act on shared resources, missing transactions, non-idempotent retried operations (webhooks, queues).
- Type escape hatches: clusters of `any` / `as` / `@ts-ignore`.
- Resource leaks: unclosed handles/connections/subscriptions, missing `finally`.
- Security (defensive framing only — never write runnable exploit strings, never copy secret values; cite `file:line` + type, recommend rotation): credential hygiene, untrusted data into interpreters/privileged APIs, access-control gaps, missing input validation, dependency advisories (critical/high, reachable only), unsafe production config, PII in logs.

### C. Quality — is the code well-built? (baseline → code)

Judged against the baseline; needs no intent.

- Duplication (same logic in 3+ places), layering violations (UI into data internals, circular deps, high-fan-in “utils”).
- Complexity: god modules an order of magnitude larger than the median, double-digit-parameter functions, deep nesting (cite the cyclomatic metric).
- Performance (architectural wins only): N+1 patterns, wrong complexity in hot loops, missing caching, unbounded payloads.
- Inconsistency: three ways of doing fetching / error handling / styling — name the convergent winner.
- Test posture: critical paths (money, auth, mutation) with zero/trivial coverage; high-churn + untested modules; tests that assert nothing.
- Dependencies: EOL / abandoned deps on critical paths, deprecated APIs with removal timelines, duplicate libraries.

---

## Missing-code proof (Hard Rule 6)

A `missing` or `unexplained`/dead-code finding claims something is **not there**. You may only claim true absence if you proved you looked everywhere it could be. Otherwise you are guessing, and an absence guess is the easiest way to embarrass an assessment.

Each absence-style finding records a result:

| Result | Meaning | Allowed wording |
|---|---|---|
| `absent` | Search space fully covered for the required record types; target not present. | bounded absence proof — “there is no …” |
| `not_found_in_index` | Target not found, but coverage is incomplete or low-confidence. | “not found in the available index” |
| `coverage_insufficient` | Index/scanner cannot support an absence claim at all. | no absence claim; recommend a deeper scan |

`absent` is valid **only if** either (1) the required record types (symbol / route / call, as relevant) have full coverage across all searched roots with no low-confidence residue, or (2) every uncovered residue is enumerated and deterministically ruled irrelevant. Otherwise downgrade. Record it inline on the finding:

```yaml
missing_code_proof:
  result: absent | not_found_in_index | coverage_insufficient
  searched_roots: [src/, lib/]
  excluded_roots: [vendor/, generated/]
  required_record_types: [symbol, route, call]
  coverage: { required: 1.0, actual: 1.0 }
  low_confidence_residues: []      # must be empty for `absent` unless ruled irrelevant below
  residues_ruled_irrelevant: []
```

This downgrade is correct behavior, not a weakness: the assessment refuses to claim absence it did not prove.

---

## Finding format

Every finding comes back in this shape (the `Evidence` line and its `strength` are mandatory):

```markdown
### [CAT-NN] Short imperative title

- **Direction**: intent→code | code→intent | baseline→code
- **Category**: alignment (missing | partial | unexplained | misalignment) | correctness | quality
- **Claim**: one sentence — what is true that shouldn't be (or is missing).
- **Evidence**: `path/file.ts:123` — what's there; plus the metric/graph fact that grounds it
  (e.g. "call graph: on checkout path", "coverage: 0%", "complexity: 41", "orphan: no inbound edges").
  For absence findings, attach the `missing_code_proof` block. Never an exploit string, never a secret value.
- **Evidence strength**: verified (a tool or your own read of the cited span confirmed it)
  | inferred (strong signal, needs a runtime check) | unverifiable (could not be checked this run).
- **Intent ref**: `intent:payment.validate_before_charge` (alignment only; `UNCONFIRMED` if intent not yet locked)
- **Severity**: P0 | P1 | P2 | P3 — assigned by the rule table below, then capped by evidence strength.
- **Confidence**: HIGH | MED | LOW.
- **Explanation**: why this is a problem — the concrete cost, tied to intent or baseline.
- **Recommendation**: the remediation direction (NOT an implementation). 1–3 sentences.
- **Bound to**: commit `<short SHA>` · intent-spec `sha256:…` · span `<span_sha256>` (for reconcile).
```

---

## Severity rubric (by rule, then capped)

Severity is reproducible because it's assigned from facts, not mood. Take the highest row that applies, **then apply the caps**.

| Severity | Rule |
|---|---|
| **P0** | Violates confirmed intent on a **critical path** (money, auth, data integrity), OR a correctness/security defect with direct data-loss / unauthorized-access impact. Must cite both the critical-path fact (call graph) and the defect/violation fact. |
| **P1** | Misalignment or correctness defect off the critical path but on a real user-facing path; OR a missing intended process (with proof) and no workaround; OR HIGH-confidence security exposure not yet P0. |
| **P2** | Quality or partial-alignment issue with a clear maintenance/perf cost; unexplained code of real size; coverage gaps on important-but-not-critical paths. |
| **P3** | Localized smells, minor inconsistency, low-impact unexplained code, docs gaps. Report only if confidence is at least MED. |

**Caps (the honesty rule, Hard Rule 4) — apply after the table, never invent new levels:**

- **Evidence strength caps severity.** `unverifiable` evidence → max P2 and framed as “investigate.” `inferred` evidence → max P1 unless a second `verified` fact independently supports the impact.
- **Confidence caps severity.** LOW confidence is never above P3.
- **Unconfirmed intent caps severity.** An `UNCONFIRMED`-intent alignment item is capped at P2 until confirmed.
- **Unproven absence caps severity.** A `missing`/dead-code finding whose `missing_code_proof.result` is not `absent` is capped at P2 and worded as “not found,” not “missing.”
- **Mechanical floors raise the minimum.** Findings on security-sensitive paths (`**/auth/**`, `**/payment/**`, `**/crypto/**`, `**/migration/**`, `**/*secret*`) carry a floor of P1 unless proven by-design.
- **By-design is not a finding.** Standard platform conventions and tradeoffs recorded in an ADR/decision doc are settled. Flag only if the *implementation* adds risk beyond the convention. Record rejected candidates so they aren't re-raised.

---

## Reconcile drift (Hard Rule 9)

`reconcile` must not re-score unchanged code, and must not be fooled by formatting. For every cited span keep two hashes:

| Field | Purpose | Changes on |
|---|---|---|
| `span_sha256` | byte-exact provenance of the checked-out bytes | CRLF, formatter, whitespace, comments |
| `normalized_fingerprint` | semantic anchor | only real semantic change (AST/token level) |

On `reconcile`: if `normalized_fingerprint` is unchanged, **reuse the prior verdict** even if `span_sha256` moved (it was only reformatted) — just refresh the line anchor. If the fingerprint changed or became ambiguous, **re-judge** that span. If the cited code is gone, **retire** the finding. If an `intent:` id no longer maps to any code, flag it as **ghost intent** (the intent spec drifted ahead of, or behind, the code) rather than silently dropping it.

---

## Determinism guardrails

- Grade severity from the rule table, then the caps — never from impression.
- Cite a fact for every finding; if you can't, it's not a finding yet.
- Never claim `absent` without a passing missing-code proof.
- Sort findings by (severity, direction, file) so the report is stable across runs.
- Keep the two buckets explicit in the report: **what is already correct** and **what is wrong**. Omitting the first makes the assessment dishonest.
