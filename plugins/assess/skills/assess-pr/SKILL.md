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
   available, `intentSpecPath`. (The engine scans the whole index so cross-file
   edges stay correct; you then filter findings to the touched files/areas.)
3. Call **`validate_graph`** on the output. If validation fails, STOP and report
   the validation errors — do not present unvalidated findings.
4. Call **`list_findings`** and keep only findings whose `targetNodeIds` touch a
   changed file. Sort by severity (P0→P3).
5. For each kept finding, surface `evidence.fact` and, for any `missing`
   finding, the `missingCodeProof.result`. If a finding lacks deterministic
   evidence or a bounded proof, do not report it.

## What to output

- A short verdict line: `<mode>: N findings on changed files (P0/P1/P2/P3).`
- Per finding: id, severity, direction, claim, and the one-line evidence fact.
- An explicit “not assessed” note for changed areas the index could not cover.

## Honesty rules (non-negotiable)

- An absence (“no handler”, “missing”) requires a `missingCodeProof`; otherwise
  downgrade to “could not confirm”.
- Without a confirmed intent spec, only `baseline_to_code` findings are valid;
  say intent alignment was not evaluated.
- Never raise severity above what the evidence strength allows.
