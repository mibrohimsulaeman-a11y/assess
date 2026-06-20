import { useStore } from "../store.js";
import { getCandidateLinkage, getFindingLinkage } from "../reviewReadiness.mjs";

function RefList({ title, items, empty = "None recorded." }: { title: string; items: string[]; empty?: string }) {
  return (
    <div className="review-detail__block">
      <h4>{title}</h4>
      {items.length === 0 ? (
        <p className="review-detail__empty">{empty}</p>
      ) : (
        <ul>
          {items.map((item) => <li key={item}><code>{item}</code></li>)}
        </ul>
      )}
    </div>
  );
}

export function ReviewDetailPanel() {
  const { graph, selectedCandidateId, selectedFindingId, selectCandidate, selectFinding } = useStore();
  if (!graph) return null;

  if (!selectedCandidateId && !selectedFindingId) {
    return (
      <section className="panel panel--muted review-detail">
        Select a candidate signal or final finding to inspect evidence refs, target nodes, counter-evidence, open questions, and semantic linkage.
      </section>
    );
  }

  if (selectedCandidateId) {
    const linkage = getCandidateLinkage(graph, selectedCandidateId);
    const candidate = linkage.candidate;
    if (!candidate) return <section className="panel panel--muted review-detail">Candidate signal not found.</section>;
    return (
      <section className="panel review-detail">
        <div className="review-detail__head">
          <span className="review-detail__eyebrow">Runtime candidate signal</span>
          <button type="button" onClick={() => selectCandidate(null)}>Clear</button>
        </div>
        <h3>{candidate.id}</h3>
        <p className="review-detail__warning">This is a runtime candidate signal, not a final finding.</p>
        <p className="review-detail__claim">{candidate.claim}</p>
        <div className="review-detail__chips">
          <span>{candidate.severity}</span>
          <span>{candidate.category}</span>
          <span>{candidate.direction}</span>
          <span>{candidate.reviewStatus}</span>
        </div>
        <p className="review-detail__evidence">{candidate.evidence.fact}</p>
        {candidate.promotedFindingId && (
          <p className="review-detail__ok">
            Accepted candidate promoted to final finding{" "}
            <button type="button" onClick={() => selectFinding(candidate.promotedFindingId ?? null)}>{candidate.promotedFindingId}</button>.
          </p>
        )}
        <RefList title="Evidence refs" items={linkage.evidenceRefs} />
        <RefList title="Target nodes" items={linkage.targetNodeIds} />
        <RefList title="Counter-evidence checked" items={linkage.counterEvidenceChecked} empty="No counter-evidence recorded yet." />
        <RefList title="Open questions" items={linkage.openQuestions} empty="No open questions recorded." />
        <RefList title="Semantic assessment node links" items={linkage.assessmentNodeIds} empty="No semantic node links yet." />
        <RefList title="Final finding links" items={linkage.findingIds} empty="No final finding link." />
      </section>
    );
  }

  const linkage = getFindingLinkage(graph, selectedFindingId!);
  const finding = linkage.finding;
  if (!finding) return <section className="panel panel--muted review-detail">Final finding not found.</section>;

  return (
    <section className="panel review-detail">
      <div className="review-detail__head">
        <span className="review-detail__eyebrow">Final reviewed finding</span>
        <button type="button" onClick={() => selectFinding(null)}>Clear</button>
      </div>
      <h3>{finding.id}</h3>
      {linkage.hasLinkageError && (
        <p className="review-detail__warning">Linkage warning: this final finding is not referenced by any semantic assessment node.</p>
      )}
      <p className="review-detail__claim">{finding.claim}</p>
      <div className="review-detail__chips">
        <span>{finding.severity}</span>
        <span>{finding.category}</span>
        <span>{finding.direction}</span>
        <span>{finding.source ?? "unknown source"}</span>
      </div>
      {finding.reasoningSummary && <p className="review-detail__evidence">Reasoning: {finding.reasoningSummary}</p>}
      <RefList title="Assessment node links" items={linkage.assessmentNodeIds} empty="No semantic node links." />
      <RefList title="Candidate signal links" items={linkage.candidateSignalIds} empty="No candidate signal links." />
      <RefList title="Evidence refs" items={linkage.evidenceRefs} />
      <RefList title="Target nodes" items={finding.targetNodeIds ?? []} />
      <RefList title="Counter-evidence checked" items={finding.counterEvidenceChecked ?? []} empty="No counter-evidence recorded." />
      <RefList title="Open questions" items={finding.openQuestions ?? []} empty="No open questions recorded." />
    </section>
  );
}
