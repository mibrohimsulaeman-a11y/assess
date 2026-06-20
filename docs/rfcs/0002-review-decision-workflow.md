# RFC 0002 — Review Decision Workflow

## Status

Accepted for M1 implementation.

## Problem

The runtime graph is a deterministic evidence substrate. It can emit
`candidateSignals`, but those signals are not final findings. Before a dashboard
or report is user-facing, every candidate signal must receive an explicit review
decision and the reviewed graph must pass the honesty validator.

Without a mechanical review artifact, semantic review is hard to audit, hard to
repeat, and easy for agents to present too early.

## Scope

In scope:

- `.assessment/<run-id>/review.decisions.json`
- runtime graph + decisions -> reviewed graph apply engine
- strict validation fixtures for accept, reject, unresolved, missing candidate,
  missing semantic node, missing counter-evidence, duplicate finding id, and
  idempotency
- CLI bridge: `review-run.mjs init|apply|validate`
- MCP bridge: `review_queue` and `apply_review_decisions`
- dashboard/report presentation gate: reviewed graph only by default

Out of scope for this RFC:

- dashboard authoring UI
- AST/tree-sitter scanner upgrades
- multi-language adapter design
- source-code mutation

## Artifact contract

```jsonc
{
  "version": "1.0.0",
  "graphPath": "assessment-graph.runtime.json",
  "reviewer": "agent:assessment-reviewer",
  "reviewedAt": "2026-01-01T01:00:00.000Z",
  "decisions": [
    {
      "candidateSignalId": "A-001",
      "decision": "accept",
      "confidence": "MED",
      "rationale": "Concise review summary, not hidden chain-of-thought.",
      "counterEvidenceChecked": [
        "checked related source files",
        "checked tests",
        "checked README/docs"
      ],
      "semanticNode": {
        "id": "assessment:A-001",
        "kind": "workflow",
        "name": "Review decision workflow gap",
        "summary": "Semantic review confirmed this as workflow-level."
      },
      "finding": {
        "id": "A-101",
        "claim": "Final reviewed claim.",
        "severity": "P2",
        "reasoningSummary": "Evidence and counter-evidence support the claim.",
        "evidenceRefs": ["candidate:A-001", "file:src/a.ts:1-20"],
        "targetNodeIds": ["file:a.ts"],
        "openQuestions": []
      }
    }
  ]
}
```

## Decision semantics

| Decision | Meaning | Apply result |
|---|---|---|
| `accept` | Candidate is valid after semantic review | Candidate becomes `accepted`, `promotedFindingId` is set, final finding is created, semantic node links both |
| `reject` | Candidate is noisy / not semantically actionable | Candidate becomes `rejected`, no final finding is created, semantic node records the rejection trail |
| `needs_more_evidence` | Reviewer cannot decide yet | Strict apply fails; dashboard/report remain blocked |

## Strict apply rules

- Runtime graph is deep-cloned; never mutated in place.
- Every candidate signal must have exactly one decision in strict mode.
- A decision must reference an existing candidate signal.
- `accept` requires `semanticNode`, `finding`, non-empty `counterEvidenceChecked`,
  and a final finding evidence ref containing `candidate:<id>`.
- `reject` requires `semanticNode`, non-empty `counterEvidenceChecked`, and must
  not create a final finding.
- Duplicate final finding IDs and duplicate semantic node IDs fail.
- Reviewed graph sets `artifact.finalFindingsSource` to `agent_review` or
  `human_review`.
- Reviewed graph cannot contain `needs_agent_review` candidate signals.
- Final findings must be referenced by at least one `assessmentNode`.
- Output is deterministic and byte-stable through the CLI writer.

## CLI

```bash
node packages/core/runtime/review-run.mjs init \
  --graph .assessment/<run-id>/assessment-graph.runtime.json \
  --out .assessment/<run-id>/review.decisions.json

node packages/core/runtime/review-run.mjs apply \
  --graph .assessment/<run-id>/assessment-graph.runtime.json \
  --decisions .assessment/<run-id>/review.decisions.json \
  --out .assessment/<run-id>/assessment-graph.reviewed.json

node packages/core/runtime/review-run.mjs validate \
  --graph .assessment/<run-id>/assessment-graph.reviewed.json
```

Package aliases:

```bash
pnpm review:init -- --graph <runtime.json> --out <review.decisions.json>
pnpm review:apply -- --graph <runtime.json> --decisions <review.decisions.json> --out <reviewed.json>
pnpm review:validate -- --graph <reviewed.json>
```

## MCP

| Tool | Purpose |
|---|---|
| `review_queue` | Group candidate signals by `needs_agent_review`, `accepted`, and `rejected` |
| `apply_review_decisions` | Apply `review.decisions.json` and write a reviewed graph |
| `validate_graph` | Validate runtime or reviewed graph honesty gates |
| `export_report` | Blocks runtime-only graphs by default; reviewed graph required unless explicitly debugging |

## Presentation gate

Do not show or serve dashboard/report from a runtime-only graph.

The user-facing gate is:

```text
artifact.finalFindingsSource in [agent_review, human_review]
assessmentNodes.length > 0
candidateSignals where reviewStatus == needs_agent_review == 0
validate_graph reviewed graph == valid:true
```

Only then may the agent present a dashboard command or report.

## Acceptance evidence

- `node packages/core/test/review-decision-fixtures.cjs`
- `node packages/core/test/run-fixtures.cjs`
- `node plugins/assess/mcp/test/mcp-contract.cjs`
- `node packages/core/scripts/validate-graph.cjs <reviewed graph>`
