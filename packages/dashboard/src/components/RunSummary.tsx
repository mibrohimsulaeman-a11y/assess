import type { AssessmentGraph, Severity } from "@assess/core";

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
  const assessmentNodes = graph.assessmentNodes?.length ?? graph.summary.assessmentNodeCount ?? 0;
  const source = graph.artifact?.finalFindingsSource ?? "legacy";

  return (
    <section className="run-summary" aria-label="Assessment run summary">
      <div className="run-summary__hero">
        <div>
          <p className="run-summary__eyebrow">Loaded semantic assessment shell</p>
          <h1>{graph.project.name}</h1>
          <p className="run-summary__headline">{graph.summary.headline}</p>
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
          <span>{candidateSignals} runtime candidate signals awaiting review</span>
        </article>
        <article className="run-card">
          <span className="run-card__label">Semantic layer</span>
          <strong>{assessmentNodes} nodes</strong>
          <span>{graph.nodes.length + graph.intents.length} fact nodes, schema {graph.version}</span>
        </article>
      </div>

      <div className="severity-strip" aria-label="Findings by severity">
        {SEVERITIES.map((sev) => (
          <span key={sev} className={`severity-pill severity-pill--${sev.toLowerCase()}`}>
            {sev} <strong>{graph.summary.bySeverity[sev] ?? 0}</strong> <span>final</span>
          </span>
        ))}
      </div>
    </section>
  );
}
