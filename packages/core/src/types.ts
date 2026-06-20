// =====================================================================
// assessment-graph types
//
// An assessment graph is NOT a comprehension graph. It is the deterministic
// code index (the fact layer) joined to confirmed intent, with a gap/finding
// overlay on top, plus a coverage manifest proving WHICH areas were assessed
// (the goal: every area). Inspired by Understand Anything's graph shape, but
// the meaning is judgment, not description.
// =====================================================================

// ---------- shared scalars ----------

export type GapDirection = "intent_to_code" | "code_to_intent" | "baseline_to_code";

export type Severity = "P0" | "P1" | "P2" | "P3";

export type Confidence = "HIGH" | "MED" | "LOW";

/** How strongly the evidence behind a claim is established. Caps severity. */
export type EvidenceStrength = "verified" | "inferred" | "unverifiable";

export type FindingCategory =
  | "alignment.missing"
  | "alignment.partial"
  | "alignment.unexplained"
  | "alignment.misalignment"
  | "correctness"
  | "quality";

/** Result of a missing-code proof (VAC §14.4). Only `absent` may claim true absence. */
export type MissingCodeResult = "absent" | "not_found_in_index" | "coverage_insufficient";

/** Per-node assessment coverage. Every scanned node gets one — nothing is silently skipped. */
export type CoverageStatus = "assessed" | "partial" | "not_assessed" | "coverage_insufficient";

/** Ownership state derived from the structural facts (VAC §12). */
export type OwnershipState =
  | "owned"
  | "shared"
  | "infrastructure"
  | "hidden"
  | "overclaimed"
  | "unowned";

export type Readiness = "ready" | "partial" | "blocked" | "unknown";

// ---------- node types ----------

// code (5) + non-code (8) + intent (2). Comprehension-only types from UA
// (tour/knowledge) are intentionally dropped; assessment adds intent + capability.
export type NodeType =
  | "file" | "function" | "class" | "module" | "concept"
  | "config" | "document" | "service" | "table" | "endpoint"
  | "pipeline" | "schema" | "resource"
  | "capability" | "intent";

export type EdgeType =
  // structural / behavioral fact edges (the deterministic index)
  | "imports" | "exports" | "contains" | "inherits" | "implements"
  | "calls" | "reads_from" | "writes_to" | "depends_on" | "tested_by" | "configures" | "routes"
  // intent overlay edges
  | "owns"            // capability -> component
  | "realizes"        // capability -> intent (a capability is meant to deliver an intent)
  // the three gap directions, as first-class edges
  | "intent_to_code"  // intent -> component
  | "code_to_intent"  // component -> capability/intent (justified or unexplained)
  | "baseline_to_code"; // finding-bearing edge for correctness/quality

// ---------- binding (drift detection) ----------

export interface Binding {
  /** short git SHA the artifact was assessed at */
  assessedAtCommit: string;
  /** sha256 of the intent-spec the artifact was judged against */
  intentSpecHash: string;
  generated: string; // ISO-8601
}

/** A span-level provenance stamp used by `reconcile` to tell reformat from real change. */
export interface SpanBinding {
  filePath: string;
  lineRange: [number, number];
  spanSha256: string;            // byte-exact: changes on whitespace/comments too
  normalizedFingerprint: string; // semantic: changes only on AST/token change
}

// ---------- evidence ----------

export interface Evidence {
  /** human-readable deterministic fact, e.g. "charge.ts:40-78 mutates balance after await" */
  fact: string;
  filePath?: string;
  lineRange?: [number, number];
  /** graph/metric facts that ground the claim */
  signals?: string[]; // e.g. ["call graph: on checkout path", "coverage: 0%", "complexity: 41"]
  strength: EvidenceStrength;
  span?: SpanBinding;
}

export interface MissingCodeProof {
  result: MissingCodeResult;
  searchedRoots: string[];
  excludedRoots: string[];
  requiredRecordTypes: Array<"symbol" | "route" | "call">;
  coverage: { required: number; actual: number };
  lowConfidenceResidues: string[];
  residuesRuledIrrelevant: string[];
}

// ---------- graph node ----------

export interface NodeAssessment {
  coverageStatus: CoverageStatus;
  ownership: OwnershipState;
  capabilityId?: string;
  /** ids into AssessmentGraph.findings (final, curated findings only) */
  findingIds: string[];
  /** ids into AssessmentGraph.candidateSignals (deterministic runtime signals, not final findings) */
  candidateSignalIds?: string[];
  readiness: Readiness;
  /** worst open severity among findingIds, for dashboard coloring */
  worstSeverity?: Severity | null;
  /** weakest evidence strength the node's assessment relied on */
  trust?: EvidenceStrength;
  /** why this node was not (fully) assessed, when coverageStatus != assessed */
  notAssessedReason?: string;
}

export interface GraphNode {
  id: string;
  type: NodeType;
  name: string;
  filePath?: string;
  lineRange?: [number, number];
  summary: string;
  tags: string[];
  complexity: "simple" | "moderate" | "complex";
  /** present on component + capability nodes; absent on pure intent nodes */
  assessment?: NodeAssessment;
  /** present on intent/capability nodes */
  intentMeta?: IntentMeta;
}

export interface IntentMeta {
  status: "CONFIRMED" | "UNCONFIRMED";
  /** for capability nodes: the component ids it claims to own */
  owns?: string[];
  /** for intent (process) nodes: the invariant that must hold */
  invariant?: string;
  criticalPath?: boolean;
}

// ---------- graph edge ----------

export interface EdgeGap {
  direction: GapDirection;
  /** join verdict for this edge */
  status:
    | "satisfied"   // intent_to_code: implemented + aligned
    | "missing"     // intent_to_code: no code path (needs MissingCodeProof)
    | "partial"     // intent_to_code: incomplete
    | "misaligned"  // intent_to_code: present but behaves differently
    | "justified"   // code_to_intent: code maps to a confirmed intent
    | "unexplained" // code_to_intent: significant code, no intent
    | "violation";  // baseline_to_code: correctness/quality defect
  /** final curated finding id; runtime should prefer candidateSignalId */
  findingId?: string;
  /** deterministic runtime candidate signal id; requires agent review before it becomes a finding */
  candidateSignalId?: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: EdgeType;
  direction: "forward" | "backward" | "bidirectional";
  weight: number; // 0..1
  description?: string;
  /** present only on the three gap-direction edge types */
  gap?: EdgeGap;
  /** the deterministic fact behind a structural edge, or a low-confidence flag */
  evidence?: { fact: string; lowConfidence?: boolean };
}

// ---------- finding ----------

export interface Finding {
  id: string; // A-### alignment, C-### correctness, Q-### quality
  direction: GapDirection;
  category: FindingCategory;
  claim: string;
  evidence: Evidence;
  intentRef?: string; // intent:<cap>.<process>, or "UNCONFIRMED"
  severity: Severity;  // after rubric + caps
  confidence: Confidence;
  explanation: string;
  recommendation: string;
  missingCodeProof?: MissingCodeProof; // required for missing / dead-code findings
  /** node ids this finding is attached to */
  targetNodeIds: string[];
  binding: Binding & Partial<Pick<SpanBinding, "spanSha256" | "normalizedFingerprint">>;
  /** Final findings must come from agent/human semantic review, never directly from runtime signals. */
  source?: "agent_review" | "human_review";
  reasoningSummary?: string;
  evidenceRefs?: string[];
  counterEvidenceChecked?: string[];
  openQuestions?: string[];
}

export interface CandidateSignal extends Omit<Finding, "source"> {
  source: "runtime_candidate";
  reviewStatus: "needs_agent_review" | "accepted" | "rejected";
  signalKind: "deterministic_gap" | "baseline_signal";
  evidenceRefs: string[];
  counterEvidenceChecked: string[];
  openQuestions: string[];
  promotedFindingId?: string;
}

export type SemanticAssessmentNodeKind =
  | "capability"
  | "workflow"
  | "risk_area"
  | "open_question"
  | "evidence_bundle";

export interface SemanticAssessmentNode {
  id: string;
  kind: SemanticAssessmentNodeKind;
  name: string;
  summary: string;
  status: "agent_inferred" | "human_confirmed" | "open_question";
  confidence: Confidence;
  evidenceRefs: string[];
  candidateSignalIds: string[];
  findingIds: string[];
}

export interface AssessmentArtifactMeta {
  type: "semantic_assessment";
  factLayerRole: "deterministic_evidence_substrate";
  runtimeSignalsAreFinalFindings: false;
  finalFindingsSource: "agent_review_required" | "agent_review" | "human_review";
  note: string;
}

export interface IntentModelSummary {
  lifecycle: "none" | "inferred" | "proposed" | "confirmed" | "mixed";
  confirmedCapabilityCount: number;
  inferredCapabilityCount: number;
  proposedCapabilityCount: number;
  rejectedCapabilityCount: number;
  entries: Array<{ id: string; status: "observed" | "inferred_intent" | "proposed_intent" | "confirmed_intent" | "rejected_intent"; label?: string }>;
}

// ---------- area + coverage manifest ----------

/** A logical area of the codebase (like a UA layer), but carrying assessment coverage. */
export interface Area {
  id: string;        // area:<kebab>
  name: string;
  description: string;
  nodeIds: string[];
  coverageStatus: CoverageStatus;
  /** rolled-up worst severity across the area */
  worstSeverity?: Severity | null;
}

/** Proves WHICH areas were assessed. The whole point: every area should be covered. */
export interface CoverageManifest {
  totalAreas: number;
  totalNodes: number;
  byStatus: Record<CoverageStatus, number>;
  /** weakest evidence strength the overall assessment relied on */
  headlineTrust: EvidenceStrength;
  /** explicit list of anything NOT fully assessed, with the reason */
  gaps: Array<{ scope: string; status: CoverageStatus; reason: string }>;
}

export interface AssessmentSummary {
  /** Final curated findings only. Runtime candidate signals are counted separately. */
  bySeverity: Record<Severity, number>;
  byCategory: Record<string, number>;
  byDirection: Record<GapDirection, number>;
  candidateBySeverity?: Record<Severity, number>;
  candidateByCategory?: Record<string, number>;
  candidateByDirection?: Record<GapDirection, number>;
  candidateSignalCount?: number;
  finalFindingCount?: number;
  assessmentNodeCount?: number;
  headline: string;
}

export interface ProjectMeta {
  name: string;
  languages: string[];
  frameworks: string[];
  description: string;
  analyzedAt: string;
  gitCommitHash: string;
}

// ---------- root ----------

export interface AssessmentGraph {
  version: string;
  kind: "assessment";
  binding: Binding;
  project: ProjectMeta;
  artifact: AssessmentArtifactMeta;
  intentModel: IntentModelSummary;
  /** semantic layer curated by agent/human review; deterministic runtime leaves this empty */
  assessmentNodes: SemanticAssessmentNode[];
  /** deterministic runtime signals; not final findings until promoted by agent/human review */
  candidateSignals: CandidateSignal[];
  /** the should-be: capability + intent (process) nodes live in `nodes`, mirrored here for quick access */
  intents: GraphNode[];
  /** fact layer: component nodes (code + non-code), with assessment overlay */
  nodes: GraphNode[];
  /** fact edges + intent edges + the three gap-direction edges */
  edges: GraphEdge[];
  findings: Finding[];
  areas: Area[];
  coverage: CoverageManifest;
  summary: AssessmentSummary;
}
