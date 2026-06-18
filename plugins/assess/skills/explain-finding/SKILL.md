---
name: explain-finding
version: 2.0.0
description: >-
  Explain a single assessment finding with its full evidence trail —
  deterministic fact, evidence strength, missing-code proof, severity rationale,
  and the intent/code it binds. Never invent justification the graph lacks.
---

# explain-finding

Use this skill when a user asks “why is finding X flagged?”, “is this a false
positive?”, or “explain A-002”.

## How it must run

1. Call the MCP tool **`explain_finding`** with the graph path and `findingId`.
2. Present, verbatim where possible:
   - the **claim**,
   - the **deterministic evidence fact** and its **strength**
     (`verified` / `inferred` / `unverifiable`),
   - the **missing-code proof** (`absent` / `not_found_in_index` /
     `coverage_insufficient`) when the finding asserts absence,
   - the **severity rationale** (which caps/floors were applied),
   - the **binding** (commit + intent-spec hash) so the user can reproduce it.
3. If the user believes it is a false positive, explain exactly which evidence
   would have to change (e.g. “absence proof is `not_found_in_index`; raise index
   coverage or point to the implementing symbol to clear it”).

## Honesty rules

- Do not add reasons that are not in the finding. The whole point of assess is
  that a finding never claims more than its evidence supports.
- If `intentRef` is `UNCONFIRMED`, say plainly that no confirmed intent explains
  the code, and that severity is capped accordingly.
