import type { Confidence, Finding, SemanticAssessmentNode } from "../types.js";

/** Review decision vocabulary for runtime candidate signals. */
export type ReviewDecisionValue = "accept" | "reject" | "needs_more_evidence";

/** Source stamped onto final findings and artifact metadata after review apply. */
export type ReviewSource = "agent_review" | "human_review";

/** Minimal semantic node input. The apply engine fills linkage fields deterministically. */
export interface ReviewSemanticNodeInput {
  id: string;
  kind: SemanticAssessmentNode["kind"];
  name: string;
  summary: string;
  status?: SemanticAssessmentNode["status"];
  confidence?: Confidence;
  evidenceRefs?: string[];
  candidateSignalIds?: string[];
  findingIds?: string[];
}

/**
 * Final-finding input for an accepted candidate. Unspecified fields inherit from
 * the candidate signal so the decision file only records semantic deltas.
 */
export type ReviewFindingInput = Partial<Omit<Finding, "source">> & {
  id: string;
  reasoningSummary?: string;
  evidenceRefs?: string[];
  counterEvidenceChecked?: string[];
  openQuestions?: string[];
  targetNodeIds?: string[];
};

export interface ReviewCandidateDecision {
  candidateSignalId: string;
  decision: ReviewDecisionValue;
  confidence: Confidence;
  rationale: string;
  counterEvidenceChecked: string[];
  openQuestions?: string[];
  semanticNode?: ReviewSemanticNodeInput;
  finding?: ReviewFindingInput;
}

export interface ReviewDecisionFile {
  version: "1.0.0";
  graphPath: string;
  reviewer: string;
  reviewedAt: string;
  decisions: ReviewCandidateDecision[];
}

export interface ApplyReviewDecisionOptions {
  /** Defaults to agent_review unless the reviewer field starts with human:. */
  finalFindingsSource?: ReviewSource;
  /** Defaults to true: every runtime candidate must receive an explicit decision. */
  requireAllCandidates?: boolean;
  /** Defaults to false: strict reviewed artifacts cannot keep open candidate decisions. */
  allowNeedsMoreEvidence?: boolean;
}
