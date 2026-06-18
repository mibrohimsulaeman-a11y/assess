import type { MissingCodeProof, MissingCodeResult } from "../types.js";

// Missing-code proof (VAC §14.4). A `missing` or dead-code finding claims
// something is NOT there. We may only assert true absence (`absent`) if the
// search space was fully covered for the required record types. Otherwise the
// claim is downgraded and severity is capped (see severity.ts). This module
// computes the result deterministically from index coverage figures.

export interface MissingCodeProofInput {
  searchedRoots: string[];
  excludedRoots: string[];
  requiredRecordTypes: Array<"symbol" | "route" | "call">;
  /** fraction (0..1) of the required record types whose index coverage is high-confidence */
  coverageActual: number;
  coverageRequired?: number; // default 1.0
  /** index regions that exist but could not be confidently parsed */
  lowConfidenceResidues?: string[];
  /** residues the caller has deterministically ruled irrelevant */
  residuesRuledIrrelevant?: string[];
}

export function computeMissingCodeProof(input: MissingCodeProofInput): MissingCodeProof {
  const coverageRequired = input.coverageRequired ?? 1.0;
  const residues = input.lowConfidenceResidues ?? [];
  const ruled = new Set(input.residuesRuledIrrelevant ?? []);
  const unresolvedResidues = residues.filter((r) => !ruled.has(r));

  let result: MissingCodeResult;
  if (input.coverageActual >= coverageRequired && unresolvedResidues.length === 0) {
    // full coverage AND every residue ruled irrelevant => bounded absence proof
    result = "absent";
  } else if (input.coverageActual >= 0.5) {
    // partial coverage: target not found, but we cannot claim true absence
    result = "not_found_in_index";
  } else {
    // too little coverage to support any absence claim
    result = "coverage_insufficient";
  }

  return {
    result,
    searchedRoots: input.searchedRoots,
    excludedRoots: input.excludedRoots,
    requiredRecordTypes: input.requiredRecordTypes,
    coverage: { required: coverageRequired, actual: input.coverageActual },
    lowConfidenceResidues: unresolvedResidues,
    residuesRuledIrrelevant: input.residuesRuledIrrelevant ?? [],
  };
}

/** Wording allowed for a given proof result — the report must not over-claim. */
export function absenceWording(result: MissingCodeResult): string {
  switch (result) {
    case "absent":
      return "there is no … (bounded absence proof)";
    case "not_found_in_index":
      return "not found in the available index";
    case "coverage_insufficient":
      return "cannot assert absence — recommend a deeper scan";
  }
}
