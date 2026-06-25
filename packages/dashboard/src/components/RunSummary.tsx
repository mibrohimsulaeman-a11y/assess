import type { AssessmentGraph, Severity } from "@assess/core";
import { getDashboardReadiness } from "../reviewReadiness.mjs";

const SEVERITIES: Severity[] = ["P0", "P1", "P2", "P3"];

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function RunSummary({ graph }: { graph: AssessmentGraph }) {
  const assessed = graph.coverage.byStatus.assessed ?? 0;
  const partial = graph.coverage.byStatus.partial ?? 0;
  const notAssessed = graph.coverage.byStatus.not_assessed ?? 0;
  const insufficient = graph.coverage.byStatus.coverage_insufficient ?? 0;
  const total = graph.coverage.totalNodes;
  const assessedPct = pct(assessed, total);
  const candidateSignals = graph.candidateSignals?.length ?? graph.summary.candidateSignalCount ?? 0;
  const acceptedCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "accepted").length;
  const pendingCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "needs_agent_review").length;
  const rejectedCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "rejected").length;
  const candidateSummary = candidateSignals
    ? `${candidateSignals} candidate signals: ${acceptedCandidates} accepted, ${pendingCandidates} awaiting review, ${rejectedCandidates} rejected`
    : "0 candidate signals";
  // G4: cluster pending candidates by claim so 16 identical "unexplained export"
  // signals read as one reviewable class, not 16 separate problems.
  const pendingByClaim = new Map<string, number>();
  for (const s of graph.candidateSignals ?? []) {
    if (s.reviewStatus !== "needs_agent_review") continue;
    pendingByClaim.set(s.claim, (pendingByClaim.get(s.claim) ?? 0) + 1);
  }
  const clusters = [...pendingByClaim.entries()].sort((a, b) => b[1] - a[1]);
  const assessmentNodes = graph.assessmentNodes?.length ?? graph.summary.assessmentNodeCount ?? 0;
  const source = graph.artifact?.finalFindingsSource ?? "legacy";
  const readiness = getDashboardReadiness(graph);

  // G4: be loud about which directions this run could actually answer. The
  // alignment (intent<->code) story is only as trustworthy as the intent behind it.
  const ic = graph.coverage.intentCoverage;
  const hasIntent = !!ic && ic.capabilitiesClaimed > 0;
  const alignmentPct = ic ? Math.round((ic.mappedRatio ?? 0) * 100) : 0;
  const provenance = ic?.weakestProvenance ?? null;
  const alignmentMode = !hasIntent
    ? "ALIGNMENT NOT ASSESSED — baseline only"
    : provenance === "agent_inferred"
      ? "ALIGNMENT PROVISIONAL — agent-inferred intent"
      : "alignment assessed";
  const alignmentDetail = !hasIntent
    ? "No confirmed intent: intent→code and code→intent were skipped; only the engineering baseline ran."
    : `${ic!.componentsMapped}/${ic!.componentsTotal} components (${alignmentPct}%) across ${ic!.capabilitiesClaimed} capability(ies); provenance: ${provenance ?? "unknown"}.`;

  return (
    <section className="run-summary" aria-label="Assessment run summary">
      <div className="run-summary__hero">
        <div>
          <p className="run-summary__eyebrow">{readiness.state.replace(/_/g, " ")}</p>
          <h1>{graph.project.name}</h1>
          <p className="run-summary__headline">{readiness.message}</p>
          <p className="run-summary__headline run-summary__headline--secondary">{graph.summary.headline}</p>
          <div className="run-summary__meta">
            <span>commit: <strong>{graph.binding.assessedAtCommit}</strong></span>
            <span>generated: <strong>{formatDate(graph.binding.generated)}</strong></span>
            <span>trust: <strong>{graph.coverage.headlineTrust}</strong></span>
            <span>final source: <strong>{source}</strong></span>
          </div>
        </div>
        <div className="run-summary__score">
          <strong>{assessedPct}%</strong>
          <span>assessed</span>
        </div>
      </div>

      <div className="run-summary__cards">
        <article className="run-card">
          <span className="run-card__label">Coverage</span>
          <strong>{assessed}/{total}</strong>
          <span>{partial} partial, {notAssessed + insufficient} not fully assessed</span>
        </article>
        <article className="run-card">
          <span className="run-card__label">Final findings</span>
          <strong>{graph.findings.length}</strong>
          <span>{candidateSummary}; candidates are not final findings</span>
        </article>
        <article className="run-card">
          <span className="run-card__label">Semantic layer</span>
          <strong>{assessmentNodes} nodes</strong>
          <span>{graph.nodes.length + graph.intents.length} fact nodes, schema {graph.version}; {readiness.userFacingReady ? "user-facing ready" : "internal only"}</span>
        </article>
        <article className={`run-card run-card--alignment${!hasIntent || provenance === "agent_inferred" ? " run-card--warn" : ""}`}>
          <span className="run-card__label">Alignment coverage</span>
          <strong>{hasIntent ? `${alignmentPct}%` : "—"}</strong>
          <span>{alignmentMode}: {alignmentDetail}</span>
        </article>
      </div>

      <div className="severity-strip" aria-label="Findings by severity">
        {SEVERITIES.map((sev) => (
          <span key={sev} className={`severity-pill severity-pill--${sev.toLowerCase()}`}>
            {sev} <strong>{graph.summary.bySeverity[sev] ?? 0}</strong> <span>final</span>
          </span>
        ))}
      </div>

      {clusters.length > 0 && (
        <div className="candidate-clusters" aria-label="Pending candidate signals grouped by claim">
          <span className="candidate-clusters__label">Pending candidate signals, grouped:</span>
          <ul>
            {clusters.map(([claim, count]) => (
              <li key={claim}>
                <strong>{count}×</strong> {claim}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
