import type { AssessmentGraph, CandidateSignal, Finding } from "@assess/core";

export type DashboardReadinessState = "runtime_only" | "partial_review" | "reviewed_ready";
export type CandidateReviewStatus = "needs_agent_review" | "accepted" | "rejected";

export const REVIEW_STATUS: CandidateReviewStatus[];

export interface CandidateGroups {
  needs_agent_review: CandidateSignal[];
  accepted: CandidateSignal[];
  rejected: CandidateSignal[];
}

export interface DashboardReadiness {
  state: DashboardReadinessState;
  userFacingReady: boolean;
  title: string;
  message: string;
  blockedReasons: string[];
  counts: {
    pendingCandidates: number;
    acceptedCandidates: number;
    rejectedCandidates: number;
    candidateSignalCount: number;
    assessmentNodeCount: number;
    finalFindingCount: number;
  };
}

export interface FindingLinkage {
  finding: Finding | null;
  assessmentNodeIds: string[];
  candidateSignalIds: string[];
  evidenceRefs: string[];
  hasLinkageError: boolean;
}

export interface CandidateLinkage {
  candidate: CandidateSignal | null;
  assessmentNodeIds: string[];
  findingIds: string[];
  evidenceRefs: string[];
  targetNodeIds: string[];
  counterEvidenceChecked: string[];
  openQuestions: string[];
}

export function groupCandidateSignalsByStatus(graph: AssessmentGraph): CandidateGroups;
export function getDashboardReadiness(graph: AssessmentGraph): DashboardReadiness;
export function getFindingLinkage(graph: AssessmentGraph, findingId: string): FindingLinkage;
export function getCandidateLinkage(graph: AssessmentGraph, candidateSignalId: string): CandidateLinkage;
