---
name: assess
description: Assess the whole repository against confirmed intent and emit a validated assessment graph.
---

Run a full, evidence-bound assessment of the current repository.

Steps the agent must follow:

1. Use the **assessment-reviewer** agent / the `assess` skill.
2. Call MCP tool `assess_repo` with `repoRoot: "."` and, if the user has an
   intent spec, `intentSpecPath`.
3. Call `validate_graph` on the output; stop and report errors if invalid.
4. Call `list_candidate_signals` and complete semantic assessment before final reporting. This normally requires reading the relevant/full source, not only the runtime graph.
5. Promote/reject candidate signals conceptually in the response; final findings require evidence refs, counter-evidence checked, and concise reasoning summary.
6. Summarize: final findings by severity, candidate signal review outcome, headline trust, and NOT-assessed areas.
7. Only point the user to the dashboard after semantic assessment is complete. Do not expose dashboard/devCommand for a runtime-only graph.

Never edit the repository. Never report a runtime candidate signal as a final finding without semantic review, evidence refs, and counter-evidence checks.
