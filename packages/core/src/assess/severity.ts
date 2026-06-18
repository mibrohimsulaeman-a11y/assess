import type {
  Confidence,
  EvidenceStrength,
  Finding,
  MissingCodeResult,
  Severity,
} from "../types.js";

// The severity engine. Severity is assigned from a rule, THEN capped by the
// honesty rules (VAC §3.3 / §6 / §19). Output can never claim stronger than the
// weakest evidence supports. This is the single source of truth the gap engine
// and the LLM pipeline both defer to, so scoring is reproducible.

const SEVERITY_ORDER: Severity[] = ["P3", "P2", "P1", "P0"];

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export function worstSeverity(severities: Severity[]): Severity | null {
  if (severities.length === 0) return null;
  return severities.reduce((acc, s) => maxSeverity(acc, s));
}

/** Lower a severity by `steps` notches, floored at P3. */
function cap(severity: Severity, max: Severity): Severity {
  return SEVERITY_ORDER.indexOf(severity) <= SEVERITY_ORDER.indexOf(max)
    ? severity
    : max;
}

export interface SeverityInputs {
  /** the severity the rubric rule table produced */
  ruleSeverity: Severity;
  evidenceStrength: EvidenceStrength;
  confidence: Confidence;
  /** true if the alignment finding's intent is not yet confirmed */
  intentUnconfirmed?: boolean;
  /** for missing/dead-code findings: result of the missing-code proof */
  missingCodeResult?: MissingCodeResult;
  /** path-based security floor (auth/payment/crypto/migration/secret) */
  securitySensitive?: boolean;
  /** has a SECOND independent verified fact supporting impact */
  secondVerifiedFact?: boolean;
}

export interface SeverityDecision {
  severity: Severity;
  applied: string[]; // human-readable list of caps/floors applied, for transparency
}

/**
 * Apply the rubric caps in order. Returns the final severity plus the list of
 * adjustments, so the report can show WHY a P0 became a P2.
 */
export function resolveSeverity(input: SeverityInputs): SeverityDecision {
  let severity = input.ruleSeverity;
  const applied: string[] = [];

  // Evidence strength cap
  if (input.evidenceStrength === "unverifiable") {
    const next = cap(severity, "P2");
    if (next !== severity) applied.push("unverifiable evidence → ≤P2 (investigate)");
    severity = next;
  } else if (input.evidenceStrength === "inferred" && !input.secondVerifiedFact) {
    const next = cap(severity, "P1");
    if (next !== severity) applied.push("inferred evidence, no 2nd verified fact → ≤P1");
    severity = next;
  }

  // Confidence cap
  if (input.confidence === "LOW") {
    const next = cap(severity, "P3");
    if (next !== severity) applied.push("LOW confidence → ≤P3");
    severity = next;
  }

  // Unconfirmed intent cap
  if (input.intentUnconfirmed) {
    const next = cap(severity, "P2");
    if (next !== severity) applied.push("UNCONFIRMED intent → ≤P2 until confirmed");
    severity = next;
  }

  // Unproven absence cap
  if (input.missingCodeResult && input.missingCodeResult !== "absent") {
    const next = cap(severity, "P2");
    if (next !== severity) applied.push(`absence ${input.missingCodeResult} → ≤P2 ("not found", not "missing")`);
    severity = next;
  }

  // Mechanical security floor (raises the minimum, applied LAST)
  if (input.securitySensitive) {
    const floored = maxSeverity(severity, "P1");
    if (floored !== severity) applied.push("security-sensitive path → floor P1");
    severity = floored;
  }

  return { severity, applied };
}

/** The weakest evidence strength across a set of findings — the report's headline_trust. */
export function headlineTrust(findings: Finding[]): EvidenceStrength {
  const rank: Record<EvidenceStrength, number> = { verified: 2, inferred: 1, unverifiable: 0 };
  let weakest: EvidenceStrength = "verified";
  for (const f of findings) {
    if (rank[f.evidence.strength] < rank[weakest]) weakest = f.evidence.strength;
  }
  return weakest;
}
