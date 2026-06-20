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
4. Summarize: mode (intent-bound vs baseline-only), final findings by severity and candidate signal count,
   headline trust, and the list of NOT-assessed areas.
5. Point the user to the dashboard (`pnpm dev:dashboard`) to explore the graph.

Never edit the repository. Never report a runtime candidate signal as a final finding without semantic review, evidence refs, and counter-evidence checks.
