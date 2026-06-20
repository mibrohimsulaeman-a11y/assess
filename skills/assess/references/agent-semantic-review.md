# Agent Semantic Review Layer

The deterministic runtime is not the assessor. It is the evidence substrate.
It may emit `candidateSignals`, but a candidate signal is not a final finding.

A final finding exists only after an agent/human semantic review pass has:

1. inspected the cited evidence refs,
2. reconstructed the relevant workflow/capability at a semantic level,
3. searched for counter-evidence,
4. checked whether the intent is observed, inferred, proposed, confirmed, or rejected,
5. produced a concise reasoning summary,
6. attached evidence refs and open questions,
7. explicitly promoted the candidate into `findings`.

## Artifact split

| Artifact field | Producer | Meaning |
|---|---|---|
| `nodes`, `edges`, `areas`, `coverage` | runtime | deterministic fact layer and coverage substrate |
| `candidateSignals` | runtime | deterministic signal requiring review; not authoritative |
| `assessmentNodes` | agent/human review | semantic capability/workflow/risk/open-question nodes |
| `findings` | agent/human review only | final curated verdicts |

## Intent lifecycle

Use these statuses instead of assuming a confirmed spec exists:

| Status | Meaning |
|---|---|
| `observed` | runtime/code fact only; no intent claim |
| `inferred_intent` | agent hypothesis from code/docs/tests |
| `proposed_intent` | draft shown to owner but not accepted |
| `confirmed_intent` | owner/doc/contract confirms should-be |
| `rejected_intent` | hypothesis disproven or declared out of scope |

## Required review loop before promotion

For every candidate signal considered for promotion:

```text
candidate signal
  -> inspect evidence refs
  -> trace nearby code path / workflow
  -> search for counter-evidence and by-design docs
  -> classify intent lifecycle
  -> decide: promote | reject | keep open question
```

Promoted final findings must include:

```jsonc
{
  "source": "agent_review" | "human_review",
  "reasoningSummary": "concise audit summary; not hidden chain-of-thought",
  "evidenceRefs": ["file:...", "function:...", "candidate:A-001"],
  "counterEvidenceChecked": ["searched tests", "searched adapters", "checked docs"],
  "openQuestions": ["..."],
  "missingCodeProof": { "...": "required for absence-style claims" }
}
```

## Quality gate

Reject or keep as open question when:

- the signal is only a low-level fact with no semantic impact,
- the code path could not be traced deeply enough,
- counter-evidence was not checked,
- intent is merely inferred but the claim wording says confirmed,
- severity depends on business criticality not established by evidence.

The dashboard must default to `assessmentNodes` + final `findings`. Runtime fact graph views are drilldown/debug views.
