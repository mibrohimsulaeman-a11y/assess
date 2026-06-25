# RFC 0007 — Intent Confirmation Gate & Provenance

## Status

Accepted for M7 implementation. Landed.

## Objective

`assess` applied first-class evidence standards to *code* (dual span hashes,
bounded missing-code proofs, severity caps) but accepted *intent* on trust: a
capability was either `CONFIRMED` or `UNCONFIRMED`, with no record of where the
confirmation came from. That asymmetry is dangerous. On a complex repo with no
docs, an agent can infer intent from the same code under assessment, judge the
code against its own inference, and emit a confident "all aligned" verdict —
the most harmful output an assessment can produce.

This RFC makes intent provenance first-class and gates the two alignment
directions on it.

```text
intent spec (+ provenance)
  -> intent-confirmation gate (G1)
  -> intent->code / code->intent only when permitted
  -> provenance caps trust (P6) and severity (G3)
  -> intent-coverage surfaced in the headline (P8)
```

## The three directions have different preconditions

| Direction | Question | Precondition | Without it |
|---|---|---|---|
| intent→code | Is what the user wanted built? | confirmed intent | **HALT, confirm with user** |
| code→intent | Does the code match the user's design/decisions? | confirmed intent | degrade honestly |
| baseline→code | Does the code pass engineering policy? | none | run fully, always valid |

`baseline→code` is the only direction that is honest without intent. The gate
exists to stop the other two from answering a question the user never confirmed.

## Mechanisms

### G1 — Intent-confirmation gate
`assessRepo` returns an `intentGate` with state `confirmed` |
`intent_provisional` | `intent_required`. `intent_required` (no confirmed intent)
blocks `intent→code` and `code→intent` presentation; the MCP `assess_repo`
response surfaces the gate so the agent must confirm intent with the user before
reporting alignment. `baseline→code` still runs.

### G2 / P5 — Intent provenance
`CapabilitySpec.provenance`: `user_confirmed` | `doc_backed` (+ `provenanceRef`) |
`agent_inferred`. Absent provenance on a `CONFIRMED` capability defaults to
`user_confirmed` (the historical meaning), so existing specs are unaffected.
Provenance is part of the intent-spec hash — re-confirming inferred intent is a
different judged-against identity.

### P6 — Provenance caps headline trust
`headlineTrust(findings, provenanceCeiling)` lowers the headline to the weakest
of (per-finding evidence, provenance ceiling). `agent_inferred` intent ceils the
headline at `inferred`, regardless of how strong the code-side evidence is.

### G3 / P7 — Anti-circularity guard
A finding judged against `agent_inferred` intent is capped at **P3** by the
severity engine and must carry a provisional open question. The validator
(both `scripts/validate-graph.cjs` and `overlay/validate.ts`) rejects any
`intent→code` finding that exceeds P3 or omits the note. The remedy is to confirm
intent, not to raise severity.

### P8 — Intent coverage
`coverage.intentCoverage` reports `capabilitiesClaimed`, `componentsMapped /
componentsTotal`, `mappedRatio`, and `weakestProvenance`. The headline states the
mapped ratio so a low-coverage run cannot masquerade as a clean bill of health.

### P3 — Co-location heuristic
An unmapped significant export that shares a file with a capability-owned
component is emitted as a P3 "likely-unlisted-helper" signal rather than a P2
scope-creep alarm — most such cases are an incomplete `ownsComponentIds` list.

### P9 / G4 — Honest dashboard
The cockpit surfaces an alignment-coverage card (flagged when baseline-only or
agent-inferred) and clusters pending candidate signals by claim, so N identical
"unexplained export" signals read as one reviewable class.

## Boundary

These mechanisms never raise a claim above its evidence. They only ever *lower*
trust/severity or *block* presentation. Provenance defaults preserve prior
behavior for user-confirmed specs; the only behavioral change for an existing
honest run is the additional intent-coverage line in the headline.

## Compatibility

- Graph schema stays `3.0.0`; new fields (`intentMeta.provenance`,
  `coverage.intentCoverage`) are optional and additive.
- Runtime (`engine.mjs`) and typed source (`src/`) carry mirrored implementations;
  both validators enforce G3 identically.
