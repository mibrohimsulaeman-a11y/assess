---
name: assess-pr
version: 2.0.0
description: >-
  Assess only what a pull request changed. Scope the assessment to the diff,
  bind it to confirmed intent, and report evidence-bound gaps (intent→code,
  code→intent, baseline→code) for the touched areas — never a free-form review.
---

# assess-pr

Use this skill when a user asks to review or assess a pull request / branch /
diff rather than the whole repository. It is the same evidence discipline as
`/assess:assess`, scoped to changed files.

## When to use

- “review this PR”, “assess my branch”, “what did this change break vs intent?”
- A CI step that wants a per-PR assessment summary.

## How it must run (deterministic boundary first)

NEVER eyeball the diff and write opinions. Always go through the engine:

1. Resolve the changed files (`git diff --name-only <base>...<head>`).
2. Call the MCP tool **`assess_repo`** with `repoRoot` = repo root and, when
   available, `intentSpecPath`. The engine scans the whole index so cross-file
   evidence stays correct.
3. Call **`validate_graph`** on the output. If validation fails, STOP and report
   the validation errors.
4. Call **`review_queue`** and **`list_candidate_signals`** for runtime signals
   awaiting semantic review. `list_findings` may legitimately be empty on a
   runtime-only graph.
5. For PR runtime-only assessment, filter `candidateSignals` to changed files,
   then review evidence/counter-evidence before deciding anything.
6. Write `review.decisions.json` with one explicit `accept`, `reject`, or
   `needs_more_evidence` decision per relevant candidate, then call
   **`apply_review_decisions`** and **`validate_graph`** on the reviewed graph.
7. Any `needs_more_evidence` decision blocks user-facing report/dashboard output.

## What to output

- A short verdict line: `<mode>: N final findings, M accepted/rejected candidates, P pending blockers.`
- Final findings and reviewed candidate outcomes in separate sections.
- Per candidate signal: id, severity, direction, claim, evidence fact, decision, and review status.
- An explicit “not assessed” note for changed areas the index could not cover.
- No dashboard/report link unless reviewed graph validation passes and pending blockers are zero.

## Honesty rules (non-negotiable)

- An absence (“no handler”, “missing”) requires a `missingCodeProof`; otherwise
  downgrade to “could not confirm”.
- Without confirmed intent, alignment signals are inferred/proposed only; do not present them as settled final findings.
- Never raise severity above what the evidence strength allows.
- Never show the dashboard or report while the graph is runtime-only (`finalFindingsSource: agent_review_required`).
- Never treat a candidate as final unless it was accepted through `review.decisions.json` and applied into a reviewed graph.
