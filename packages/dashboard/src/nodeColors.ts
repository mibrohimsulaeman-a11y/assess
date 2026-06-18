import type { CoverageStatus, OwnershipState, Severity } from "@assess/core";

// Color is meaning, not decoration. The gap map colors by WORST severity, the
// coverage map colors by assessment status (so unassessed areas are visually
// loud), and ownership uses a separate ramp. Kept in one place so legend and
// nodes never drift.

export const SEVERITY_COLOR: Record<Severity, string> = {
  P0: "#b91c1c", // red-700
  P1: "#ea580c", // orange-600
  P2: "#ca8a04", // yellow-600
  P3: "#0369a1", // sky-700
};

export const COVERAGE_COLOR: Record<CoverageStatus, string> = {
  assessed: "#15803d",              // green-700: judged
  partial: "#ca8a04",              // yellow-600: incomplete
  coverage_insufficient: "#9333ea",// purple-600: not enough index to judge
  not_assessed: "#dc2626",         // red-600: NOT looked at — loud on purpose
};

export const OWNERSHIP_COLOR: Record<OwnershipState, string> = {
  owned: "#15803d",
  shared: "#0891b2",
  infrastructure: "#64748b",
  hidden: "#9333ea",
  overclaimed: "#dc2626",
  unowned: "#a16207",
};

export const NO_FINDING_COLOR = "#15803d";

export function severityColor(sev: Severity | null | undefined): string {
  return sev ? SEVERITY_COLOR[sev] : NO_FINDING_COLOR;
}
