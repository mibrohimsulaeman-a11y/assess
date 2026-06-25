import { createHash } from "node:crypto";
import type { GraphNode, IntentProvenance } from "../types.js";
import type { IntentExpectation } from "../assess/gap-engine.js";

export type { IntentProvenance };

// INTENT-GATE — the should-be model. assess never invents intent; it elicits and
// the user CONFIRMS it (see references/intent-elicitation.md). The confirmed
// spec is hashed; that hash is stamped into every finding's binding so a later
// run can tell whether a verdict was made against the same intent (VAC §5).

// IntentProvenance is defined in types.ts and re-exported above. It records WHERE a
// confirmed intent came from (user_confirmed | doc_backed | agent_inferred) so the
// tool can cap trust and catch self-confirmation, just as span hashes ground code.

export interface CapabilitySpec {
  id: string;          // capability:<kebab>
  label: string;
  description: string;
  status: "CONFIRMED" | "UNCONFIRMED";
  /** Source of this confirmed intent. Defaults to user_confirmed when omitted (historical meaning of CONFIRMED). */
  provenance?: IntentProvenance;
  /** For doc_backed provenance: a pointer to the artifact (path/URL/ticket id). */
  provenanceRef?: string;
  ownsComponentIds: string[];
  processes: ProcessSpec[];
}

export interface ProcessSpec {
  id: string;          // intent:<cap>.<process>
  label: string;
  invariant: string;   // the rule that must hold
  criticalPath: boolean;
  securitySensitive?: boolean;
  expectedComponentIds: string[];
}

export interface IntentSpec {
  project: string;
  capabilities: CapabilitySpec[];
}

/** Stable hash of the CONFIRMED intent model. Order-independent. */
export function hashIntentSpec(spec: IntentSpec): string {
  const confirmed = {
    project: spec.project,
    capabilities: spec.capabilities
      .filter((c) => c.status === "CONFIRMED")
      .map((c) => ({
        id: c.id,
        owns: [...c.ownsComponentIds].sort(),
        processes: c.processes
          .map((p) => ({ id: p.id, invariant: p.invariant, critical: p.criticalPath }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return "ispec:" + createHash("sha256").update(JSON.stringify(confirmed), "utf8").digest("hex");
}

/** Capability + intent nodes for the graph (the should-be side). */
export function intentNodes(spec: IntentSpec): GraphNode[] {
  const nodes: GraphNode[] = [];
  for (const cap of spec.capabilities) {
    nodes.push({
      id: cap.id,
      type: "capability",
      name: cap.label,
      summary: cap.description,
      tags: ["intent"],
      complexity: "simple",
      intentMeta: { status: cap.status, owns: cap.ownsComponentIds },
    });
    for (const p of cap.processes) {
      nodes.push({
        id: p.id,
        type: "intent",
        name: p.label,
        summary: p.invariant,
        tags: ["intent", p.criticalPath ? "critical-path" : "normal"],
        complexity: "simple",
        intentMeta: {
          status: cap.status,
          invariant: p.invariant,
          criticalPath: p.criticalPath,
        },
      });
    }
  }
  return nodes;
}

/** Flatten the spec into the expectation list the gap engine consumes. */
export function toExpectations(spec: IntentSpec): IntentExpectation[] {
  const out: IntentExpectation[] = [];
  for (const cap of spec.capabilities) {
    for (const p of cap.processes) {
      out.push({
        intentId: p.id,
        capabilityId: cap.id,
        label: p.label,
        invariant: p.invariant,
        criticalPath: p.criticalPath,
        securitySensitive: p.securitySensitive,
        expectedComponentIds: p.expectedComponentIds,
      });
    }
  }
  return out;
}
