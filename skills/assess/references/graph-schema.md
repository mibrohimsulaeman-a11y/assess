# assessment-graph.json schema

The machine artifact the pipeline writes to `.assessment/assessment-graph.json`
and the dashboard renders. Authoritative definition: `@assess/core`
(`src/types.ts` + `src/schema.ts`). This page is the human summary.

> An assessment graph is the deterministic code index (the **fact layer**)
> joined to **confirmed intent**, with a **gap/finding overlay** and a
> **coverage manifest** proving which areas were assessed. It is not a
> comprehension graph: `kind` is always `"assessment"`.

## Top level

```jsonc
{
  "version": "2.0.0",
  "kind": "assessment",          // discriminator; dashboard refuses anything else
  "binding": { "assessedAtCommit", "intentSpecHash", "generated" },
  "project": { "name", "languages", "frameworks", "description", "analyzedAt", "gitCommitHash" },
  "intents":  [GraphNode],       // capability + intent (process) nodes — the should-be
  "nodes":    [GraphNode],       // fact-layer components, each with an assessment overlay
  "edges":    [GraphEdge],       // fact edges + intent edges + the 3 gap-direction edges
  "findings": [Finding],
  "areas":    [Area],            // logical partitions, each with a coverage status
  "coverage": CoverageManifest,  // proves WHICH areas were assessed
  "summary":  AssessmentSummary
}
```

## Node types

Code (`file` `function` `class` `module` `concept`) + non-code (`config`
`document` `service` `table` `endpoint` `pipeline` `schema` `resource`) +
intent (`capability` `intent`). UA’s comprehension-only types (tour/knowledge)
are dropped; `capability` + `intent` are added.

### The assessment overlay (component nodes)

```jsonc
"assessment": {
  "coverageStatus": "assessed" | "partial" | "not_assessed" | "coverage_insufficient",
  "ownership": "owned" | "shared" | "infrastructure" | "hidden" | "overclaimed" | "unowned",
  "findingIds": ["A-001"],
  "readiness": "ready" | "partial" | "blocked" | "unknown",
  "worstSeverity": "P1" | null,
  "trust": "verified" | "inferred" | "unverifiable",
  "notAssessedReason": "…"          // required when coverageStatus != assessed
}
```

**Every assessable node must carry this overlay** — that is the coverage
guarantee. `intent` / `capability` nodes carry `intentMeta` instead.

## Gap edges (the heart of the graph)

The three directions are first-class edge types, each carrying a verdict:

| `type` | `gap.direction` | `gap.status` values |
|---|---|---|
| `intent_to_code` | intent\u2192code | `satisfied` `partial` `misaligned` `missing` |
| `code_to_intent` | code\u2192intent | `justified` `unexplained` |
| `baseline_to_code` | baseline\u2192code | `violation` |

`missing` and `unexplained` edges point at the sentinels the validator allows
(`intent:UNCONFIRMED`, `baseline`) when there is no concrete counterpart node.

## Finding

```jsonc
{
  "id": "A-001",                       // A=alignment, C=correctness, Q=quality
  "direction": "intent_to_code",
  "category": "alignment.misalignment", // .missing/.partial/.unexplained/.misalignment | correctness | quality
  "claim": "…",
  "evidence": { "fact", "filePath?", "lineRange?", "signals?", "strength", "span?" },
  "intentRef": "intent:payments.charge-idempotency" | "UNCONFIRMED",
  "severity": "P0".. "P3",             // after rule + caps
  "confidence": "HIGH" | "MED" | "LOW",
  "explanation": "… (lists which caps were applied)",
  "recommendation": "…",
  "missingCodeProof?": { "result": "absent" | "not_found_in_index" | "coverage_insufficient", … },
  "targetNodeIds": ["…"],
  "binding": { "assessedAtCommit", "intentSpecHash", "generated", "spanSha256?", "normalizedFingerprint?" }
}
```

## Coverage manifest — the differentiator

```jsonc
"coverage": {
  "totalAreas": 2,
  "totalNodes": 5,                       // assessable nodes only
  "byStatus": { "assessed": 4, "partial": 0, "not_assessed": 1, "coverage_insufficient": 0 },
  "headlineTrust": "inferred",           // weakest evidence the verdicts relied on
  "gaps": [ { "scope": "webhooks", "status": "not_assessed", "reason": "…" } ]
}
```

`byStatus` MUST sum to `totalNodes` (validator error otherwise). Anything not
`assessed` appears in `gaps`. The goal is `byStatus.assessed == totalNodes` and
`gaps == []` — the whole repo assessed.

## Honesty invariants (enforced by validate.ts / validate-graph.cjs)

- Every edge endpoint and `findingId` resolves (or is a known sentinel).
- Every assessable node has a `coverageStatus`; the manifest tallies all of them.
- An absence claim without a `missingCodeProof` is a warning; a P0 on an
  unproven absence is an error.
- A finding on `unverifiable` evidence may not be P0/P1; a P0 against
  `UNCONFIRMED` intent is an error.
