# Assessment Artifacts

Everything `assess` writes lives under `.assessment/` in the repo root. Artifacts are plain JSON or Markdown so any agent or human can read them. If committed, they must never contain a secret value.

```
.assessment/
  assessment-graph.json          ← runtime graph from assess_repo / assess-run; candidateSignals only
  assessment-graph.runtime.json  ← optional pinned runtime input for review apply
  review.decisions.json          ← explicit accept/reject/needs_more_evidence audit trail
  assessment-graph.reviewed.json ← reviewed graph eligible for dashboard/report
  intent-spec.md                 ← confirmed/proposed should-be model when available
  knowledge-graph.md             ← optional: semantic capabilities/workflows overlay
  report.md                      ← final findings from reviewed graph only
  implementation-plan.md         ← optional: ordered plan to close reviewed gaps
  baseline-debt.md               ← optional: consciously accepted gaps, with expiry
  findings/                      ← optional: one file per reviewed finding, for large assessments
    A-001-*.md
```

Every artifact carries a binding header so a later run can detect drift:

```yaml
# binding (top of every artifact)
assessed_at_commit: <short SHA>
intent_spec_hash: sha256:…     # the intent the artifact was judged against
generated: <YYYY-MM-DD>
```


## Runtime candidates vs final report

`assessment-graph.json` may contain many `candidateSignals` and zero final
`findings`. That is valid. The report must keep them separate:

- **Final findings** — promoted after semantic review; include reasoning summary,
  evidence refs, counter-evidence checked, and open questions.
- **Runtime candidate signals** — deterministic evidence needing review; useful
  substrate but not authoritative.

Do not generate user-facing `report.md` from a runtime-only graph. Do not turn
candidate signals into report findings unless `review.decisions.json` has been
applied, every candidate is accepted or rejected, and the reviewed graph passes
validation.

---

## `intent-spec.md` — the confirmed should-be

Written in the SAME vocabulary as the deterministic facts (capability / module / role / symbol) so gap analysis is a literal join. Each capability is locked as the user confirms it.

```markdown
# Intent Spec

> The confirmed should-be for this codebase. Assessment judges the code against THIS file.
> Update it when intent changes, not when code changes.

assessed_at_commit: <short SHA>
status: CONFIRMED | PARTIAL (some capabilities UNCONFIRMED)

## Capability: <name>  —  status: CONFIRMED | UNCONFIRMED

- **Purpose** (should-be): one or two sentences — what this capability is supposed to do.
- **Code as-is** (confirmed reading): the facts the user agreed describe the current code.
- **Owns**: `module:<name>` — the components/files/symbols this capability owns (feeds the knowledge graph).
- **Intended processes**:
  - `intent:<capability>.<process>` — what should happen, and any invariant
    (e.g. `intent:payment.validate_before_charge` — a charge must be preceded by a validated cart; idempotent on retry).
- **Critical paths**: which processes are money/auth/data-integrity (drives P0 + mechanical floor).
- **Decided tradeoffs**: anything from an ADR/PRD that is settled and must NOT be re-flagged.
```

Keep `intent:` and `capability:` IDs stable — findings, the plan, and the graph all reference them, and `reconcile` matches on them.

---

## `report.md` — the reviewed assessment

The primary product. Generate it only from `assessment-graph.reviewed.json`. Two
buckets, always both present, plus an honest trust line.

```markdown
# Assessment Report

assessed_at_commit: <short SHA>
intent: CONFIRMED | PARTIAL (N capabilities UNCONFIRMED) — see intent-spec.md
effort: quick | standard | deep
headline_trust: <weakest evidence strength among the findings this report relies on>

## Scope

- **Assessed**: what was covered.
- **NOT assessed**: modules/categories skipped, and facts that could not be deterministically verified.

## Summary

Counts by severity × category, and the one-line headline
("core flows align; checkout idempotency is the one P0").

| Severity | Alignment | Correctness | Quality |
|----------|-----------|-------------|---------|
| P0       | 1         | 0           | 0       |
| P1       | ...       | ...         | ...     |

## What is already correct

Processes that align with intent AND meet the baseline. Be specific and cite evidence —
an assessment that only lists problems is incomplete and misleads about overall health.

- `intent:auth.session_expiry` — implemented at `auth/session.ts:40-88`, covered (94%),
  matches the intended 30-min idle timeout. [evidence strength: verified]

## What is wrong

Ordered by (severity, direction, file). Each entry uses the Finding format from
`assessment-rubric.md`. For large reports, summarize here and link to `findings/<id>.md`.

## Considered and rejected

Candidates with `reviewStatus: rejected`, one line each, including the
counter-evidence checked, so they are not re-raised next run.
```

---

## Finding file (optional, for large assessments)

One file per finding in `.assessment/findings/`. The id encodes category + number: `A` alignment, `C` correctness, `Q` quality. Use the full Finding format from `assessment-rubric.md`, including `Evidence strength`, the `missing_code_proof` block for absence findings, and the `Bound to` line.

```markdown
# [A-001] Charge path has no idempotency guard

- **Direction**: intent→code
- **Category**: alignment / misalignment
- **Intent ref**: `intent:payment.validate_before_charge` (CONFIRMED)
- **Evidence**: `src/payment/charge.ts:40-78` — charges then writes, no dedup key;
  call graph: reachable from `checkout` + `stripe-webhook`; coverage: 0%.
- **Evidence strength**: verified
- **Severity**: P0  ·  **Confidence**: HIGH
- **Explanation**: a retried webhook/client retry double-charges; violates the confirmed
  “idempotent on retry” invariant on a money path → P0 (mechanical floor also applies).
- **Recommendation**: introduce an idempotency key checked before the charge write. Direction only.
- **Bound to**: commit `9f2c1ab` · intent-spec `sha256:…` · span `sha256:7b3e…c10`
```

---

## `baseline-debt.md` — consciously accepted gaps

Not every gap gets fixed now. Baseline debt records a gap the team **accepts for a bounded scope and time**, so `assess` stops re-raising it — but the acceptance expires, unlike a silent omission.

```markdown
# Baseline Debt

assessed_at_commit: <short SHA>

- **Debt**: `Q-014` duplication across the three report renderers.
- **Accepted by**: <who> on <date>
- **Scope**: `src/render/**` only.
- **Reason**: refactor scheduled with the v2 rendering work.
- **Severity if unaccepted**: P2
- **Review by**: <date>   # after this, assess re-raises it
```

Stale debt (past `Review by`, or after the intent it referenced drifted) cannot suppress a finding — `reconcile` re-raises it.

---

## Quality bar — check before finishing

- Every finding cites a deterministic fact with an explicit **evidence strength**? If not, drop it or mark “investigate.”
- Every alignment finding tied to a confirmed `intent:` id (or tagged `UNCONFIRMED`)?
- Every absence finding carries a `missing_code_proof`, and severity is capped if the result isn't `absent`?
- Severity assigned from the rule table **and** the caps applied?
- BOTH buckets present — what's correct and what's wrong?
- `headline_trust` set to the weakest evidence strength the report relies on?
- Report states what was NOT assessed and which facts couldn't be verified?
- No secret values anywhere — locations and credential types only.
- Binding header present so `reconcile` can drift-check next run.
