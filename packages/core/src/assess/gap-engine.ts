import type {
  EdgeGap,
  Finding,
  GapDirection,
  GraphEdge,
  GraphNode,
} from "../types.js";
import { resolveSeverity, type SeverityInputs } from "./severity.js";

// The assessment engine. It does NOT describe the codebase; it JOINS the
// confirmed intent model to the deterministic fact layer and emits a verdict
// per pairing. Three directions (Codebase Assessment Engine §15 / VAC):
//
//   intent_to_code : for each promised capability/process — is it implemented,
//                    partial, misaligned, or missing?  (over-promise)
//   code_to_intent : for each significant component — does it map to a confirmed
//                    intent, or is it unexplained?      (under-explain / dead code)
//   baseline_to_code: for each component — does it violate a universal baseline
//                     (correctness/security/quality) regardless of intent?
//
// Every produced edge/finding is bindable and severity-capped.

export interface IntentExpectation {
  intentId: string;       // intent:<cap>.<process>
  capabilityId: string;
  label: string;
  invariant?: string;
  criticalPath?: boolean;
  /** component ids the intent claims should exist / behave a certain way */
  expectedComponentIds: string[];
  securitySensitive?: boolean;
}

export interface ComponentObservation {
  nodeId: string;
  /** does an implementing code path exist in the index? */
  implemented: boolean;
  /** if implemented, does behavior match the invariant? */
  aligned: "yes" | "partial" | "no" | "unknown";
  /** significant component with no confirmed intent mapping */
  mappedIntentId?: string;
  significance: "high" | "low";
  evidenceFact: string;
  evidenceStrength: SeverityInputs["evidenceStrength"];
  confidence: SeverityInputs["confidence"];
  /** baseline violations detected deterministically (e.g. "await before mutation") */
  baselineViolations?: Array<{
    rule: string;
    ruleSeverity: SeverityInputs["ruleSeverity"];
    fact: string;
    securitySensitive?: boolean;
  }>;
}

let seq = { A: 0, C: 0, Q: 0 };
export function resetFindingIds() {
  seq = { A: 0, C: 0, Q: 0 };
}
function nextId(prefix: "A" | "C" | "Q"): string {
  seq[prefix] += 1;
  return `${prefix}-${String(seq[prefix]).padStart(3, "0")}`;
}

function edge(
  source: string,
  target: string,
  direction: GapDirection,
  status: EdgeGap["status"],
  findingId: string | undefined,
  fact: string,
): GraphEdge {
  const type = direction; // edge type names match the three directions
  return {
    id: `gap:${direction}:${source}->${target}`,
    source,
    target,
    type,
    direction: "forward",
    weight: status === "satisfied" || status === "justified" ? 0.3 : 0.9,
    gap: { direction, status, findingId },
    evidence: { fact },
  };
}

export interface GapEngineResult {
  findings: Finding[];
  edges: GraphEdge[];
}

/** Direction 1 — intent → code. Catches over-promising (missing/partial/misaligned). */
export function assessIntentToCode(
  expectations: IntentExpectation[],
  observations: Map<string, ComponentObservation>,
  bindingCommit: string,
  intentSpecHash: string,
): GapEngineResult {
  const findings: Finding[] = [];
  const edges: GraphEdge[] = [];
  const generated = new Date().toISOString();

  for (const exp of expectations) {
    for (const compId of exp.expectedComponentIds) {
      const obs = observations.get(compId);
      const implemented = obs?.implemented ?? false;
      const aligned = obs?.aligned ?? "unknown";

      let status: EdgeGap["status"];
      let category: Finding["category"] | null = null;
      let ruleSeverity: SeverityInputs["ruleSeverity"] = "P2";

      if (!implemented) {
        status = "missing";
        category = "alignment.missing";
        ruleSeverity = exp.criticalPath ? "P0" : "P1";
      } else if (aligned === "no") {
        status = "misaligned";
        category = "alignment.misalignment";
        ruleSeverity = exp.criticalPath ? "P0" : "P1";
      } else if (aligned === "partial" || aligned === "unknown") {
        status = "partial";
        category = "alignment.partial";
        ruleSeverity = "P2";
      } else {
        status = "satisfied";
      }

      let findingId: string | undefined;
      if (category) {
        findingId = nextId("A");
        const decision = resolveSeverity({
          ruleSeverity,
          evidenceStrength: obs?.evidenceStrength ?? "inferred",
          confidence: obs?.confidence ?? "MED",
          securitySensitive: exp.securitySensitive,
          // missing findings need a proof attached by the caller; until then cap at P2
          missingCodeResult: status === "missing" ? "not_found_in_index" : undefined,
        });
        findings.push({
          id: findingId,
          direction: "intent_to_code",
          category,
          claim:
            status === "missing"
              ? `Promised "${exp.label}" has no implementing path in the index`
              : status === "misaligned"
                ? `"${exp.label}" is implemented but violates its invariant`
                : `"${exp.label}" is only partially implemented`,
          evidence: {
            fact: obs?.evidenceFact ?? `no record found for ${compId}`,
            strength: obs?.evidenceStrength ?? "inferred",
            signals: exp.invariant ? [`invariant: ${exp.invariant}`] : undefined,
          },
          intentRef: exp.intentId,
          severity: decision.severity,
          confidence: obs?.confidence ?? "MED",
          explanation: decision.applied.length
            ? `Severity adjustments: ${decision.applied.join("; ")}.`
            : "Severity from rubric rule table.",
          recommendation:
            status === "missing"
              ? "Implement the promised behavior or retract the claim from intent."
              : "Reconcile the implementation with the stated invariant.",
          targetNodeIds: [compId, exp.intentId],
          binding: { assessedAtCommit: bindingCommit, intentSpecHash, generated },
        });
      }
      edges.push(
        edge(exp.intentId, compId, "intent_to_code", status, findingId,
          status === "satisfied" ? "implemented and aligned" : (findingId ?? "")),
      );
    }
  }
  return { findings, edges };
}

/** Direction 2 — code → intent. Catches unexplained / dead code (under-explaining). */
export function assessCodeToIntent(
  observations: ComponentObservation[],
  bindingCommit: string,
  intentSpecHash: string,
): GapEngineResult {
  const findings: Finding[] = [];
  const edges: GraphEdge[] = [];
  const generated = new Date().toISOString();

  for (const obs of observations) {
    if (obs.mappedIntentId) {
      edges.push(edge(obs.nodeId, obs.mappedIntentId, "code_to_intent", "justified", undefined, "maps to confirmed intent"));
      continue;
    }
    if (obs.significance !== "high") continue; // ignore trivial unmapped code

    const findingId = nextId("A");
    const decision = resolveSeverity({
      ruleSeverity: "P2",
      evidenceStrength: obs.evidenceStrength,
      confidence: obs.confidence,
    });
    findings.push({
      id: findingId,
      direction: "code_to_intent",
      category: "alignment.unexplained",
      claim: `Significant component has no confirmed intent that explains it`,
      evidence: { fact: obs.evidenceFact, strength: obs.evidenceStrength },
      intentRef: "UNCONFIRMED",
      severity: decision.severity,
      confidence: obs.confidence,
      explanation: "Could be intentional-but-undocumented, dead code, or scope creep. Confirm with owner.",
      recommendation: "Confirm whether this is intended; document it or remove it.",
      targetNodeIds: [obs.nodeId],
      binding: { assessedAtCommit: bindingCommit, intentSpecHash, generated },
    });
    edges.push(edge(obs.nodeId, "intent:UNCONFIRMED", "code_to_intent", "unexplained", findingId, "no confirmed intent"));
  }
  return { findings, edges };
}

/** Direction 3 — baseline → code. Universal correctness/quality, intent-independent. */
export function assessBaseline(
  observations: ComponentObservation[],
  bindingCommit: string,
  intentSpecHash: string,
): GapEngineResult {
  const findings: Finding[] = [];
  const edges: GraphEdge[] = [];
  const generated = new Date().toISOString();

  for (const obs of observations) {
    for (const v of obs.baselineViolations ?? []) {
      const isQuality = /complex|duplicat|smell|dead branch|naming/i.test(v.rule);
      const findingId = nextId(isQuality ? "Q" : "C");
      const decision = resolveSeverity({
        ruleSeverity: v.ruleSeverity,
        evidenceStrength: obs.evidenceStrength,
        confidence: obs.confidence,
        securitySensitive: v.securitySensitive,
      });
      findings.push({
        id: findingId,
        direction: "baseline_to_code",
        category: isQuality ? "quality" : "correctness",
        claim: v.rule,
        evidence: { fact: v.fact, strength: obs.evidenceStrength },
        severity: decision.severity,
        confidence: obs.confidence,
        explanation: decision.applied.length ? decision.applied.join("; ") : "Baseline rule violation.",
        recommendation: "Fix to restore the baseline invariant.",
        targetNodeIds: [obs.nodeId],
        binding: { assessedAtCommit: bindingCommit, intentSpecHash, generated },
      });
      edges.push(edge("baseline", obs.nodeId, "baseline_to_code", "violation", findingId, v.rule));
    }
  }
  return { findings, edges };
}
