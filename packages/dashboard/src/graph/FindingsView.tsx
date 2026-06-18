import type { CSSProperties } from "react";
import type { AssessmentGraph } from "@assess/core";
import { useStore, visibleFindings } from "../store.js";
import { SEVERITY_COLOR } from "../nodeColors.js";

const ARROW = "\u2192";
const MIDDOT = "\u00b7";

const DIRECTION_LABEL: Record<string, string> = {
  intent_to_code: `intent ${ARROW} code`,
  code_to_intent: `code ${ARROW} intent`,
  baseline_to_code: `baseline ${ARROW} code`,
};

const STRENGTH_BADGE: Record<string, CSSProperties> = {
  verified: { background: "#dcfce7", color: "#166534" },
  inferred: { background: "#fef9c3", color: "#854d0e" },
  unverifiable: { background: "#fee2e2", color: "#991b1b" },
};

const SEV_RANK: Record<string, number> = { P0: 3, P1: 2, P2: 1, P3: 0 };

export function FindingsView({ graph }: { graph: AssessmentGraph }) {
  const { filters, selectFinding, selectNode } = useStore();
  const findings = visibleFindings(graph, filters).sort(
    (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0),
  );

  return (
    <div className="findings">
      {findings.length === 0 && (
        <p className="findings__empty">No findings match the current filters.</p>
      )}
      {findings.map((f) => {
        const sb = STRENGTH_BADGE[f.evidence.strength];
        const sevStyle: CSSProperties = { background: SEVERITY_COLOR[f.severity], color: "#fff" };
        const line = f.evidence.lineRange
          ? `:${f.evidence.lineRange[0]}-${f.evidence.lineRange[1]}`
          : "";
        const loc = f.evidence.filePath ? `  (${f.evidence.filePath}${line})` : "";
        return (
          <article
            key={f.id}
            className="finding"
            onClick={() => {
              selectFinding(f.id);
              selectNode(f.targetNodeIds[0] ?? null);
            }}
          >
            <div className="finding__head">
              <span className="finding__sev" style={sevStyle}>
                {f.severity}
              </span>
              <code className="finding__id">{f.id}</code>
              <span className="finding__dir">{DIRECTION_LABEL[f.direction]}</span>
              <span className="finding__cat">{f.category}</span>
              <span className="finding__strength" style={sb}>
                {f.evidence.strength}
              </span>
            </div>
            <p className="finding__claim">{f.claim}</p>
            <p className="finding__evidence">{`${ARROW} ${f.evidence.fact}${loc}`}</p>
            {f.missingCodeProof && (
              <p className="finding__proof">
                {`absence proof: ${f.missingCodeProof.result} ${MIDDOT} coverage ${Math.round(
                  f.missingCodeProof.coverage.actual * 100,
                )}%`}
              </p>
            )}
            <p className="finding__rec">{`Fix: ${f.recommendation}`}</p>
          </article>
        );
      })}
    </div>
  );
}
