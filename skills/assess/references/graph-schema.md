# assessment-graph.json schema

The machine artifact written to `.assessment/assessment-graph.json` and rendered
by the dashboard. Authoritative definition: `@assess/core` (`src/types.ts` +
`src/schema.ts`). This page is the human summary for schema v3.

> Runtime facts are evidence substrate. Runtime `candidateSignals` are not final
> findings. Final `findings` and `assessmentNodes` exist only after agent/human
> semantic review.

## Top level

```jsonc
{
  "version": "3.0.0",
  "kind": "assessment",
  "binding": { "assessedAtCommit", "intentSpecHash", "generated" },
  "project": { "name", "languages", "frameworks", "description", "analyzedAt", "gitCommitHash" },
  "artifact": {
    "type": "semantic_assessment",
    "factLayerRole": "deterministic_evidence_substrate",
    "runtimeSignalsAreFinalFindings": false,
    "finalFindingsSource": "agent_review_required" | "agent_review" | "human_review",
    "note": "...",
    "adapterRuns?": [LanguageAdapterRunMeta],
    "frameworkRuns?": [FrameworkPackRunMeta]
  },
  "intentModel": IntentModelSummary,
  "assessmentNodes": [SemanticAssessmentNode],
  "candidateSignals": [CandidateSignal],
  "intents": [GraphNode],
  "nodes": [GraphNode],
  "edges": [GraphEdge],
  "findings": [Finding],
  "areas": [Area],
  "coverage": CoverageManifest,
  "summary": AssessmentSummary
}
```

## Artifact split

| Field | Producer | Meaning |
|---|---|---|
| `nodes`, `edges`, `areas`, `coverage` | runtime | deterministic facts + coverage substrate |
| `artifact.adapterRuns` | runtime | language adapter coverage and limitations |
| `artifact.frameworkRuns` | runtime | framework pack coverage, emitted fact counts, and limitations |
| `candidateSignals` | runtime | evidence-backed signals requiring review |
| `review.decisions.json` | agent/human review | sidecar audit trail: one decision per runtime candidate |
| `assessmentNodes` | agent/human review | semantic capabilities, workflows, risk areas, open questions |
| `findings` | agent/human review only | final curated verdicts created from accepted decisions |

## Intent lifecycle

`intentModel.entries[].status` is one of:

| Status | Meaning |
|---|---|
| `observed` | code fact only; no intent claim |
| `inferred_intent` | agent hypothesis from code/docs/tests |
| `proposed_intent` | draft shown to owner but not accepted |
| `confirmed_intent` | should-be confirmed by owner/doc/contract |
| `rejected_intent` | hypothesis disproven or out of scope |

## GraphNode assessment overlay

```jsonc
"assessment": {
  "coverageStatus": "assessed" | "partial" | "not_assessed" | "coverage_insufficient",
  "ownership": "owned" | "shared" | "infrastructure" | "hidden" | "overclaimed" | "unowned",
  "findingIds": ["A-001"],              // final findings only
  "candidateSignalIds": ["A-001"],      // runtime signals only
  "readiness": "ready" | "partial" | "blocked" | "unknown",
  "worstSeverity": "P1" | null,
  "trust": "verified" | "inferred" | "unverifiable",
  "notAssessedReason": "..."
}
```

Every assessable node must carry `coverageStatus`; anything not fully assessed
must appear in `coverage.gaps`.

## CandidateSignal

A runtime candidate signal has the same core evidence fields as a finding, plus
runtime-review metadata:

```jsonc
{
  "id": "A-001",
  "source": "runtime_candidate",
  "reviewStatus": "needs_agent_review" | "accepted" | "rejected",
  "signalKind": "deterministic_gap" | "baseline_signal",
  "direction": "intent_to_code" | "code_to_intent" | "baseline_to_code",
  "category": "alignment.missing" | "alignment.unexplained" | "correctness" | "quality" | "...",
  "claim": "...",
  "evidence": { "fact", "strength", "filePath?", "lineRange?", "signals?" },
  "missingCodeProof?": { "result", "searchedRoots", "coverage", "..." },
  "evidenceRefs": ["candidate:A-001", "file:src/x.ts:1-20"],
  "counterEvidenceChecked": ["searched roots: .", "absence result: not_found_in_index"],
  "openQuestions": ["Agent semantic review required"]
}
```

Candidate signals are shown in the dashboard as fact-layer evidence. They are not
mixed with final findings.

## FrameworkPackRunMeta

Framework packs run after language adapters. They emit deterministic
endpoint/resource/config facts and framework edges; they do not produce final
findings or behavioral claims.

```jsonc
{
  "packId": "express-v1",
  "displayName": "Express/Fastify framework pack",
  "frameworkIds": ["Express"],
  "languageIds": ["JavaScript", "TypeScript"],
  "detected": true,
  "confidence": "HIGH" | "MED" | "LOW",
  "endpointNodeCount": 2,
  "resourceNodeCount": 0,
  "configNodeCount": 0,
  "frameworkEdgeCount": 2,
  "observationCount": 2,
  "limitations": ["does not resolve dynamic route path composition"]
}
```

M6 endpoint nodes use `type: "endpoint"` and are connected by `routes` edges:

```jsonc
{
  "id": "endpoint:express:src/server.ts:get:/users",
  "type": "endpoint",
  "name": "GET /users",
  "filePath": "src/server.ts",
  "lineRange": [12, 12],
  "tags": ["framework:express", "http", "route", "method:get"]
}
```

Framework packs may prove that a literal endpoint declaration exists. They do
not prove auth/RBAC, middleware order, request/response schema correctness,
handler behavior, or business correctness.

## ReviewDecisionFile sidecar

`review.decisions.json` is not embedded in the graph. It is the auditable input
used to produce a reviewed graph:

```jsonc
{
  "version": "1.0.0",
  "graphPath": "assessment-graph.runtime.json",
  "reviewer": "agent:assessment-reviewer",
  "reviewedAt": "2026-01-01T01:00:00.000Z",
  "decisions": [
    {
      "candidateSignalId": "A-001",
      "decision": "accept" | "reject" | "needs_more_evidence",
      "confidence": "HIGH" | "MED" | "LOW",
      "rationale": "concise audit summary",
      "counterEvidenceChecked": ["checked source", "checked tests", "checked docs"],
      "semanticNode": { "id": "assessment:A-001", "kind": "workflow", "name": "...", "summary": "..." },
      "finding": { "id": "A-101", "evidenceRefs": ["candidate:A-001"], "reasoningSummary": "..." }
    }
  ]
}
```

Strict reviewed apply fails when any candidate remains `needs_more_evidence`.

## Final Finding

A final finding must be promoted by agent/human review:

```jsonc
{
  "id": "A-001",
  "source": "agent_review" | "human_review",
  "direction": "...",
  "category": "...",
  "claim": "...",
  "evidence": { "..." },
  "reasoningSummary": "concise audit summary, not hidden chain-of-thought",
  "evidenceRefs": ["candidate:A-001", "file:src/x.ts:1-20"],
  "counterEvidenceChecked": ["searched tests", "checked docs", "traced workflow"],
  "openQuestions": ["..."],
  "severity": "P0" | "P1" | "P2" | "P3",
  "confidence": "HIGH" | "MED" | "LOW",
  "recommendation": "...",
  "binding": { "assessedAtCommit", "intentSpecHash", "generated", "spanSha256?", "normalizedFingerprint?" }
}
```

If `artifact.finalFindingsSource` is `agent_review_required`, `findings` must be
empty. The validator rejects final findings without `source`, `reasoningSummary`,
`evidenceRefs`, and `counterEvidenceChecked`.

## Honesty invariants

- Every edge endpoint resolves or is an allowed sentinel (`baseline`, `intent:UNCONFIRMED`).
- Every gap edge references either a final `findingId` or a runtime `candidateSignalId`.
- Every absence-style candidate/finding has `missingCodeProof`.
- P0/P1 cannot be based on unproven absence.
- P0/P1 cannot be based on unverifiable evidence.
- P0 cannot be raised against `UNCONFIRMED` intent.
- `intent→code` findings judged against `agent_inferred` (circular) intent are capped at P3 and must carry a provisional open question (G3). Intent `provenance` (`user_confirmed` / `doc_backed` / `agent_inferred`) lives on `intentMeta`; `agent_inferred` also caps headline trust at `inferred` (P6).
- `coverage.intentCoverage` (when present) reports alignment coverage — how many components map to a confirmed capability — and the headline must state it (P8).
- Runtime cannot publish final findings when the artifact says agent review is required.
- Reviewed graphs require at least one `assessmentNode` and zero pending candidates.
- Accepted candidates require `promotedFindingId`; rejected candidates must not have one.
- Reviewed final findings require counter-evidence and assessment-node linkage.
