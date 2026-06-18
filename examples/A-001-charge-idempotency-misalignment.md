> **Sample output.** An illustrative finding produced by `/assess` against a
> hypothetical payments service, kept here as an example of the format. It is
> not a real repo — run `/assess` on your own codebase instead.

# [A-001] Charge path has no idempotency guard

- **Category**: alignment / misalignment
- **Intent ref**: `intent:payment.validate_before_charge` (CONFIRMED)
- **Severity**: P0
- **Confidence**: HIGH
- **Assessed at**: commit `9f2c1ab`, 2026-06-15

## Claim

`processPayment()` promises idempotency — by its name, and by the intent the user
confirmed ("a charge must be idempotent on retry") — but a retried call charges
the customer twice. This is a misalignment: a code path exists for the intended
process, but it behaves differently than intended.

## Evidence (deterministic)

- `src/payment/charge.ts:40-78` — builds the charge, calls the gateway, then writes
  the `orders` row. There is no idempotency key and no check-then-act guard before
  the gateway call.
- **Call graph**: reachable from the `checkout` HTTP entry point and from the
  `stripe-webhook` handler — i.e. on the money critical path, and invoked by a
  retrying caller.
- **Coverage**: 0% on the `charge.ts:40-78` span (no test exercises the retry path).
- Reproducibility anchor: `span_sha256: 7b3e…c10` (so `reconcile` reuses this
  verdict while the span is unchanged).

## Explanation

Stripe retries webhooks on non-2xx responses, and the client retries on timeout.
Because the handler is reachable on that path with no dedup key, each retry runs
the full charge again. The confirmed intent for this domain states the charge
must be idempotent on retry; the implementation violates that invariant on a
money path. Per the severity rubric — confirmed-intent violation on a critical
path, grounded by the call-graph fact — this is **P0**.

## Recommendation

Derive an idempotency key from the order/intent id and check it (or rely on the
gateway's idempotency-key header) before the charge write, so a retry is a no-op.
Direction only — `assess` does not implement; hand this to an executor or the team,
and add a test covering the double-submit path (currently 0% covered).

---

## How this finding was built (illustrative trace)

1. **Facts (Phase 1)** — the call graph put `charge.ts` on the `checkout` +
   `stripe-webhook` paths; coverage reported 0% on the span. Pure deterministic
   facts, no judgment yet.
2. **Intent (Phase 2)** — the user confirmed both questions for the `payment`
   domain: *yes, the code charges then writes* (as-is), and *yes, it must be
   idempotent on retry* (should-be). That second answer is what makes this a
   finding rather than a description.
3. **Gap (Phase 3)** — backward+forward join found a path for
   `intent:payment.validate_before_charge` that exists but diverges → misalignment.
4. **Judgment (Phase 4)** — severity assigned by rule (critical-path + intent
   violation + verified facts → P0), every clause pinned to a deterministic fact.
