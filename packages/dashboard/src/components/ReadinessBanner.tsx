import type { AssessmentGraph } from "@assess/core";
import { getDashboardReadiness } from "../reviewReadiness.mjs";

const STATE_LABEL: Record<string, string> = {
  runtime_only: "runtime-only graph",
  partial_review: "partial review graph",
  reviewed_ready: "reviewed graph",
};

export function ReadinessBanner({ graph }: { graph: AssessmentGraph }) {
  const readiness = getDashboardReadiness(graph);
  return (
    <section className={`readiness readiness--${readiness.state}`} aria-label="Dashboard review readiness">
      <div className="readiness__main">
        <span className="readiness__state">{STATE_LABEL[readiness.state]}</span>
        <div>
          <h2>{readiness.title}</h2>
          <p>{readiness.message}</p>
        </div>
      </div>
      <div className="readiness__counts">
        <span><strong>{readiness.counts.pendingCandidates}</strong> needs review</span>
        <span><strong>{readiness.counts.acceptedCandidates}</strong> accepted</span>
        <span><strong>{readiness.counts.rejectedCandidates}</strong> rejected</span>
        <span><strong>{readiness.counts.assessmentNodeCount}</strong> semantic nodes</span>
        <span><strong>{readiness.counts.finalFindingCount}</strong> final findings</span>
      </div>
      {readiness.blockedReasons.length > 0 && (
        <ul className="readiness__reasons">
          {readiness.blockedReasons.map((reason) => <li key={reason}>{reason}</li>)}
        </ul>
      )}
    </section>
  );
}
