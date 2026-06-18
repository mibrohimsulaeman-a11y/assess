---
name: explain-finding
description: Explain one assessment finding with its full evidence trail and severity rationale.
---

Explain a single finding.

Steps:

1. Use the `explain-finding` skill.
2. Call MCP tool `explain_finding` with the graph path and the finding id.
3. Show: claim, deterministic evidence fact + strength, missing-code proof (if
   any), severity rationale (caps/floors applied), and the binding
   (commit + intent-spec hash).
4. If the user disputes it, explain exactly which evidence would clear it.

Do not add justification the graph does not contain.
