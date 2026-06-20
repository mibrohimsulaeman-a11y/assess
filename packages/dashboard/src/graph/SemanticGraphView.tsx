import type { CSSProperties } from "react";
import type { AssessmentGraph, CandidateSignal, SemanticAssessmentNode } from "@assess/core";
import { useStore, visibleCandidateSignals } from "../store.js";
import { SEVERITY_COLOR } from "../nodeColors.js";

const SEV_RANK: Record<string, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };

function candidateStyle(signal: CandidateSignal): CSSProperties {
  return { borderLeft: `6px solid ${SEVERITY_COLOR[signal.severity]}` };
}

function SemanticNodeCard({ node }: { node: SemanticAssessmentNode }) {
  return (
    <article className="semantic-card semantic-card--node">
      <div className="semantic-card__head">
        <span className="semantic-chip semantic-chip--kind">{node.kind}</span>
        <span className="semantic-chip">{node.status}</span>
        <span className="semantic-chip">confidence {node.confidence}</span>
      </div>
      <h3>{node.name}</h3>
      <p>{node.summary}</p>
      <p className="semantic-card__meta">
        evidence refs: {node.evidenceRefs.length} · candidate signals: {node.candidateSignalIds.length} · findings: {node.findingIds.length}
      </p>
    </article>
  );
}

function CandidateSignalCard({ signal }: { signal: CandidateSignal }) {
  const statusCopy = signal.reviewStatus === "accepted"
    ? `Reviewed and promoted to ${signal.promotedFindingId ?? "a final finding"}.`
    : signal.reviewStatus === "rejected"
      ? "Reviewed and rejected; kept only as audit trace."
      : "Runtime signal only. Agent must inspect evidence, counter-evidence, and domain intent before promoting this to a final finding.";
  return (
    <article className="semantic-card semantic-card--signal" style={candidateStyle(signal)}>
      <div className="semantic-card__head">
        <span className="semantic-chip semantic-chip--severity">{signal.severity}</span>
        <code>{signal.id}</code>
        <span className="semantic-chip">{signal.direction}</span>
        <span className="semantic-chip">{signal.reviewStatus}</span>
        {signal.promotedFindingId && <span className="semantic-chip">promoted to {signal.promotedFindingId}</span>}
      </div>
      <h3>{signal.claim}</h3>
      <p className="semantic-card__evidence">{signal.evidence.fact}</p>
      <p className="semantic-card__meta">{statusCopy}</p>
      {signal.openQuestions.length > 0 && (
        <ul className="semantic-card__questions">
          {signal.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      )}
    </article>
  );
}

export function SemanticGraphView({ graph }: { graph: AssessmentGraph }) {
  const { filters } = useStore();
  const candidateSignals = visibleCandidateSignals(graph, filters).sort(
    (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0),
  );
  const acceptedCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "accepted").length;
  const pendingCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "needs_agent_review").length;
  const rejectedCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "rejected").length;

  return (
    <div className="semantic-view">
      <section className="semantic-hero">
        <p className="semantic-hero__eyebrow">Semantic assessment layer</p>
        <h2>{graph.artifact?.finalFindingsSource === "agent_review_required" ? "Agent review required" : "Agent-reviewed assessment"}</h2>
        <p>
          Runtime facts are available as evidence, but final findings and semantic nodes must be produced by a reasoning pass.
          This dashboard defaults to the curated semantic layer; raw fact nodes are kept in the drilldown tabs.
        </p>
        <div className="semantic-hero__stats">
          <span><strong>{graph.assessmentNodes?.length ?? 0}</strong> semantic nodes</span>
          <span><strong>{graph.findings.length}</strong> final findings</span>
          <span><strong>{graph.candidateSignals?.length ?? 0}</strong> candidate signals</span>
          <span><strong>{acceptedCandidates}</strong> accepted</span>
          <span><strong>{pendingCandidates}</strong> awaiting review</span>
          <span><strong>{rejectedCandidates}</strong> rejected</span>
          <span><strong>{graph.intentModel?.lifecycle ?? "none"}</strong> intent lifecycle</span>
        </div>
      </section>

      {(graph.assessmentNodes?.length ?? 0) > 0 ? (
        <section className="semantic-section">
          <h2>Curated semantic nodes</h2>
          <div className="semantic-grid">
            {graph.assessmentNodes.map((node) => <SemanticNodeCard key={node.id} node={node} />)}
          </div>
        </section>
      ) : (
        <section className="semantic-empty">
          <h2>No curated semantic nodes yet</h2>
          <p>
            This is intentional for a runtime-only run. The next layer must infer/propose intent, inspect code paths,
            check counter-evidence, then write semantic nodes and final findings with evidence refs.
          </p>
        </section>
      )}

      <section className="semantic-section">
        <h2>Candidate signals — review status</h2>
        {candidateSignals.length === 0 ? (
          <p className="findings__empty">No candidate signals match the current filters.</p>
        ) : (
          <div className="semantic-list">
            {candidateSignals.map((signal) => <CandidateSignalCard key={signal.id} signal={signal} />)}
          </div>
        )}
      </section>
    </div>
  );
}
