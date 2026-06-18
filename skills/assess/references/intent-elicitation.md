# Intent Elicitation & the Confirmation Gate

This is the step that turns a description into an assessment. A descriptive tool has one input (the code) and assumes *code = truth*. You need a second source — **intent** — and for most codebases it isn't written down anywhere. So you derive a candidate, confirm it with the user, and persist it. Skip this and you are back to “code = truth,” grading chaos as correct.

---

## 1. Derive, don't interrogate

The deterministic facts already give you most of a candidate intent for free. Use them — do not start with a blank questionnaire.

- **Capability skeleton** from the repo manifest + file roles (Service / Controller / Repository / Model / EntryPoint) + import clusters. Each cluster is a candidate `capability:`.
- **Top-down ordering** from entry points + the import graph (what calls what).
- **Stated intent** from docs read in recon: README promises, ADRs (`docs/adr/`), PRDs, `CONTEXT.md` (domain vocabulary), `PRODUCT.md` (named users / use cases). A decision doc is the strongest intent signal there is — prefer it over anything you infer, and never contradict a decision it records (note the contradiction as a finding instead).

From these, write a candidate picture: “The code appears to implement capabilities X, Y, Z; X does A, B, C.” This is a hypothesis, not a verdict.

## 2. The two questions are NOT the same

The central trap. Asking only *“is this what your codebase does?”* confirms exactly one thing: that you read the code correctly (accuracy of the as-is). For an assessment you also need the second, different question: *“is this what your system is SUPPOSED to do?”* (the should-be).

- For a **clean** codebase the two collapse into one (code = intent) and confirmation is fast.
- For a **messy** one they diverge sharply. If you only confirm “does your code do X?” and the user says yes, you have merely blessed the chaos as correct. **The delta between the two answers is the assessment.**

So the checkpoint always captures both:

> Here is what I see your code doing in the `payment` capability: [A, B, C].
> 1. Did I read that right? (correct my understanding of the as-is)
> 2. Is that what it SHOULD do? (tell me the intended process — the should-be)

Record the answers separately: confirmed as-is feeds *correctness/quality*; declared should-be feeds *alignment*.

## 3. Stage it top-down

Don't drill into line-level intent before the big picture is agreed.

1. **Confirm high-level capabilities first.** “I see `Auth`, `Billing`, `Notifications` — right?” Cheap, fast, and it catches the expensive misreads early (a whole capability you mislabeled).
2. **Then drill into each confirmed capability** for the detailed should-be: per-process expectations, invariants, critical paths.
3. Confirmation becomes **confirmation, not interrogation**: lead with what the facts already show (“capability `payment`: 3 services, 1 controller, writes to `orders` — is this payment processing?”), so the user is correcting a draft, not authoring from scratch.

Keep each checkpoint small and answerable. Batch by capability, not by line.

## 4. Persist and bind the confirmed intent

Write the locked intent to `.assessment/intent-spec.md` (see `report-template.md` for the format). Three reasons this matters:

- **Reproducibility.** Future runs assess against *saved* intent, not a freshly-guessed one — the same code judged against the same intent yields the same verdicts.
- **Shared vocabulary.** Encode intent in the SAME terms as the facts (capability / module / role / symbol). Gap analysis is then a literal join: `intent-without-code = missing`, `code-without-intent = unexplained`, `both-but-different = misalignment`. The `capability:` ids and their `Owns:` lists are also what the knowledge graph is built from.
- **Binding.** Record the assessed commit (`git rev-parse --short HEAD`) and a content hash of the spec at the top of the file. Findings, the plan, and the graph all stamp `intent_spec_hash`, so `reconcile` can tell whether the intent itself drifted.

Lock intent **per capability** as each is confirmed — you can begin judging a confirmed capability while later ones are still being confirmed.

## 5. Ghost intent (drift on reconcile)

Intent can drift out of sync with code in either direction. On `reconcile`, after re-matching spans:

- An `intent:` id that no longer maps to any code is **ghost intent** — either the feature was removed (the spec is stale) or it was never built (a standing `missing` finding). Surface it; never silently drop it.
- Code that grew a new import-cluster with no `capability:` above it is a **candidate new capability** — propose adding it to the spec (a code→intent gap), don't assess it against absent intent.

## 6. When the user can't confirm

Non-interactive run, or the user defers? Then:

- Still derive and persist the candidate intent, but mark every entry `status: UNCONFIRMED`.
- Alignment findings derived from unconfirmed intent are reported with capped severity (≤P2) and an explicit `intent: UNCONFIRMED` tag — never presented as settled.
- Correctness and quality findings (which don't need intent) proceed normally.
- Make the first recommendation in the report: “confirm the intent spec to unlock alignment grading.”

## 7. What good intent elicitation avoids

- **Leading the witness.** Don't ask “you do want X, right?” Present what the code shows and ask what it *should* do.
- **Over-asking.** If the facts or a decision doc already answer it, don't ask — resolve from evidence first; only genuine ambiguity becomes a question, one at a time, each with your recommended answer.
- **Treating confirmation as a rubber stamp.** The second question (should-be) is the whole point; never drop it for speed.
