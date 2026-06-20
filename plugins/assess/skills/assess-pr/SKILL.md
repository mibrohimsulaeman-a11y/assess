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
4. Call **`list_findings`** for already-promoted final findings, and
   **`list_candidate_signals`** for runtime signals awaiting semantic review.
5. For PR runtime-only assessment, filter `candidateSignals` to changed files,
   then review evidence/counter-evidence before promoting anything to a final
   PR finding. `list_findings` may legitimately be empty.

## What to output

- A short verdict line: `<mode>: N final findings, M candidate signals on changed files.`
- Final findings and runtime candidate signals in separate sections.
- Per candidate signal: id, severity, direction, claim, evidence fact, and review status.
- An explicit “not assessed” note for changed areas the index could not cover.
- No dashboard link unless semantic assessment is complete and candidate signals are reviewed.

## Honesty rules (non-negotiable)

- An absence (“no handler”, “missing”) requires a `missingCodeProof`; otherwise
  downgrade to “could not confirm”.
- Without confirmed intent, alignment signals are inferred/proposed only; do not present them as settled final findings.
- Never raise severity above what the evidence strength allows.
- Never show the dashboard while the graph is runtime-only (`finalFindingsSource: agent_review_required`).
