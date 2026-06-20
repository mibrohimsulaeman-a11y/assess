import type { CSSProperties } from "react";
import type { AssessmentGraph, CandidateSignal, SemanticAssessmentNode } from "@assess/core";
import { useStore } from "../store.js";
import { SEVERITY_COLOR } from "../nodeColors.js";
import { getCandidateLinkage, groupCandidateSignalsByStatus } from "../reviewReadiness.mjs";

const SEV_RANK: Record<string, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };

const QUEUE_LABEL: Record<string, string> = {
  needs_agent_review: "Needs review",
  accepted: "Accepted",
  rejected: "Rejected",
};

const QUEUE_COPY: Record<string, string> = {
  needs_agent_review: "Runtime candidate signals waiting for semantic review. These are not final findings.",
  accepted: "Reviewed candidates that were promoted into final findings.",
  rejected: "Reviewed candidates kept as audit trace because counter-evidence or context rejected them.",
};

type QueueStatus = "needs_agent_review" | "accepted" | "rejected";

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
      <div className="semantic-link-row">
        {node.candidateSignalIds.map((id) => <code key={id}>candidate:{id}</code>)}
        {node.findingIds.map((id) => <code key={id}>finding:{id}</code>)}
      </div>
    </article>
  );
}

function CandidateSignalCard({ graph, signal }: { graph: AssessmentGraph; signal: CandidateSignal }) {
  const { selectCandidate, selectFinding } = useStore();
  const linkage = getCandidateLinkage(graph, signal.id);
  const statusCopy = signal.reviewStatus === "accepted"
    ? `Accepted by review and promoted to ${signal.promotedFindingId ?? "a final finding"}.`
    : signal.reviewStatus === "rejected"
      ? "Reviewed and rejected; kept only as audit trace with counter-evidence."
      : "Runtime candidate signal only. It is not a final finding until review decisions are applied and validation passes.";
  return (
    <article className="semantic-card semantic-card--signal" style={candidateStyle(signal)} onClick={() => selectCandidate(signal.id)}>
      <div className="semantic-card__head">
        <span className="semantic-chip semantic-chip--severity">{signal.severity}</span>
        <code>{signal.id}</code>
        <span className="semantic-chip">{signal.category}</span>
        <span className="semantic-chip">{signal.direction}</span>
        <span className="semantic-chip semantic-chip--status">{signal.reviewStatus}</span>
        {signal.promotedFindingId && (
          <button
            type="button"
            className="semantic-inline-button"
            onClick={(event) => {
              event.stopPropagation();
              selectFinding(signal.promotedFindingId ?? null);
            }}
          >
            promoted to {signal.promotedFindingId}
          </button>
        )}
      </div>
      <h3>{signal.claim}</h3>
      <p className="semantic-card__evidence">{signal.evidence.fact}</p>
      <p className="semantic-card__meta">{statusCopy}</p>
      <div className="semantic-card__linkage">
        <span>targets: {signal.targetNodeIds.length ? signal.targetNodeIds.join(", ") : "none"}</span>
        <span>semantic nodes: {linkage.assessmentNodeIds.length ? linkage.assessmentNodeIds.join(", ") : "none"}</span>
        <span>final findings: {linkage.findingIds.length ? linkage.findingIds.join(", ") : "none"}</span>
      </div>
      <details className="semantic-card__details" onClick={(event) => event.stopPropagation()}>
        <summary>Evidence preview</summary>
        <p>This is a runtime candidate signal, not a final finding.</p>
        <ul>
          {(signal.evidenceRefs ?? []).map((ref) => <li key={ref}><code>{ref}</code></li>)}
        </ul>
        {(signal.counterEvidenceChecked ?? []).length > 0 && (
          <>
            <p>Counter-evidence checked:</p>
            <ul>
              {signal.counterEvidenceChecked.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </>
        )}
      </details>
      {signal.openQuestions.length > 0 && (
        <ul className="semantic-card__questions">
          {signal.openQuestions.map((q, i) => <li key={i}>{q}</li>)}
        </ul>
      )}
    </article>
  );
}

function CandidateQueue({ graph }: { graph: AssessmentGraph }) {
  const grouped = groupCandidateSignalsByStatus(graph);
  const statuses: QueueStatus[] = ["needs_agent_review", "accepted", "rejected"];
  return (
    <section className="semantic-section">
      <h2>Candidate review queue</h2>
      <p className="semantic-section__copy">
        Candidate signals are deterministic runtime signals, not final findings. Use this queue to see exactly what still blocks user-facing presentation.
      </p>
      <div className="queue-grid">
        {statuses.map((status) => {
          const signals = [...grouped[status]].sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0));
          return (
            <section key={status} className={`queue-column queue-column--${status}`}>
              <div className="queue-column__head">
                <h3>{QUEUE_LABEL[status]}</h3>
                <span>{signals.length}</span>
              </div>
              <p>{QUEUE_COPY[status]}</p>
              {signals.length === 0 ? (
                <p className="queue-column__empty">No candidates in this bucket.</p>
              ) : (
                <div className="semantic-list">
                  {signals.map((signal) => <CandidateSignalCard key={signal.id} graph={graph} signal={signal} />)}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function SemanticGraphView({ graph }: { graph: AssessmentGraph }) {
  const acceptedCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "accepted").length;
  const pendingCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "needs_agent_review").length;
  const rejectedCandidates = (graph.candidateSignals ?? []).filter((s) => s.reviewStatus === "rejected").length;

  return (
    <div className="semantic-view">
      <section className="semantic-hero">
        <p className="semantic-hero__eyebrow">Semantic assessment layer</p>
        <h2>{graph.artifact?.finalFindingsSource === "agent_review_required" ? "Agent review required" : "Agent-reviewed assessment"}</h2>
        <p>
          Runtime facts are evidence substrate. Candidate signals are deterministic runtime signals, not final findings.
          Final findings and semantic nodes must come from applied review decisions.
        </p>
        <div className="semantic-hero__stats">
          <span><strong>{graph.assessmentNodes?.length ?? 0}</strong> semantic nodes</span>
          <span><strong>{graph.findings.length}</strong> final findings</span>
          <span><strong>{graph.candidateSignals?.length ?? 0}</strong> candidate signals</span>
          <span><strong>{acceptedCandidates}</strong> accepted</span>
          <span><strong>{pendingCandidates}</strong> needs review</span>
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
        <section className="semantic-empty semantic-empty--blocked">
          <h2>No curated semantic nodes yet</h2>
          <p>
            This graph is runtime-only or partially reviewed. Apply review decisions to create semantic assessment nodes and final findings before presenting dashboard/report output.
          </p>
        </section>
      )}

      <CandidateQueue graph={graph} />
    </div>
  );
}
