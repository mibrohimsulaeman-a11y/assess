---
name: assess-pr
description: Assess only the files changed by the current PR/branch and report evidence-bound gaps.
---

Assess just the diff.

Steps:

1. Use the `assess-pr` skill.
2. Determine changed files via `git diff --name-only <base>...HEAD`.
3. Call `assess_repo` (whole-index scan for correct edges), then `validate_graph`.
4. Filter findings to changed files, sort P0→P3, and show one-line evidence each.
5. State any changed area that could not be assessed.

Never edit code. Drop any finding lacking deterministic evidence or a bounded
missing-code proof.
