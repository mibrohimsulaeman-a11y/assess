---
name: assess-pr
description: Assess only the files changed by the current PR/branch and report evidence-bound gaps.
---

Assess just the diff.

Steps:

1. Use the `assess-pr` skill.
2. Determine changed files via `git diff --name-only <base>...HEAD`.
3. Call `assess_repo` (whole-index scan for correct edges), then `validate_graph`.
4. Filter candidate signals to changed files, but keep the whole-index context for evidence.
5. Review candidate signals against changed source and counter-evidence before treating anything as a PR finding.
6. Write/apply `review.decisions.json`; any `needs_more_evidence` decision keeps the PR report blocked.
7. State any changed area that could not be assessed.
8. Do not share dashboard/devCommand or report until reviewed graph validation passes; the cockpit must show zero pending blockers.

Never edit code. Drop or keep as open question any candidate signal lacking semantic review evidence or bounded missing-code proof.
