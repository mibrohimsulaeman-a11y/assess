import type { CSSProperties } from "react";
import type { AssessmentGraph, CoverageStatus } from "@assess/core";
import { COVERAGE_COLOR } from "../nodeColors.js";

// The honesty headline. Sits above every view and states, in one line, how much
// of the repo was actually assessed and the weakest evidence the verdicts rely
// on. If anything was not assessed, it is named here — never hidden.

const ORDER: CoverageStatus[] = ["assessed", "partial", "coverage_insufficient", "not_assessed"];

export function CoverageBanner({ graph }: { graph: AssessmentGraph }) {
  const c = graph.coverage;
  const assessed = c.byStatus.assessed ?? 0;
  const pct = c.totalNodes ? Math.round((assessed / c.totalNodes) * 100) : 0;
  const fully = pct === 100 && c.gaps.length === 0;
  const total = c.totalNodes || 1;

  return (
    <div className="banner">
      <div className="banner__bar">
        {ORDER.map((s) => {
          const n = c.byStatus[s] ?? 0;
          if (!n) return null;
          const segStyle: CSSProperties = {
            background: COVERAGE_COLOR[s],
            width: `${(n / total) * 100}%`,
          };
          return <div key={s} className="banner__seg" title={`${s}: ${n}`} style={segStyle} />;
        })}
      </div>
      <div className="banner__text">
        <strong>{pct}% assessed</strong> ({assessed}/{c.totalNodes} nodes, {c.totalAreas} areas)
        {" \u00b7 "}
        headline trust: <strong>{c.headlineTrust}</strong>
        {" \u00b7 "}
        {fully ? (
          <span className="banner__ok">whole repo assessed</span>
        ) : (
          <span className="banner__warn">{c.gaps.length} area(s)/node(s) NOT fully assessed</span>
        )}
      </div>
      {c.gaps.length > 0 && (
        <details className="banner__gaps">
          <summary>What was not assessed</summary>
          <ul>
            {c.gaps.map((g, i) => (
              <li key={i}>
                <strong>{g.scope}</strong> &mdash; {g.status}: {g.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
