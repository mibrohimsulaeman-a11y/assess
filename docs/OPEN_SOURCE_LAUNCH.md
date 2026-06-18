# Open-source launch plan

This project should be launched as an assessment layer, not as a generic
knowledge-graph clone.

## Positioning

Primary sentence:

> `assess` is an intent-vs-code assessment graph for agentic software teams.

Do not lead with "UA alternative". A better framing:

- Knowledge-graph tools explain what exists.
- PR reviewers comment on changes.
- Static analyzers catch known classes of defects.
- `assess` judges whether a repository can honestly claim that code satisfies
  confirmed intent, with explicit coverage and evidence limits.

## Pre-public checklist

Required before making the repository public:

- [x] Set `.claude-plugin/plugin.json` and `package.json` repository metadata to `mibrohimsulaeman-a11y/assess`.
- [ ] Confirm author/organization name in `LICENSE.md`.
- [ ] Add at least one screenshot or short dashboard GIF.
- [x] Document post-run dashboard flow in `docs/DASHBOARD_CONCEPT.md`.
- [ ] Run `node packages/core/test/run-fixtures.cjs`.
- [ ] Run `node packages/core/scripts/validate-graph.cjs packages/dashboard/public/assessment-graph.json`.
- [ ] Run `pnpm install`, `pnpm test`, and `pnpm build` in a networked dev environment.
- [ ] Commit `pnpm-lock.yaml` after install.
- [ ] Enable GitHub Discussions only if you will actively triage them.
- [ ] Enable private vulnerability reporting.
- [ ] Add repository topics: `codebase-assessment`, `intent-vs-code`,
  `knowledge-graph`, `ai-code-review`, `static-analysis`, `developer-tools`,
  `claude-plugin`.

## First public release

Recommended tag: `v0.1.0`.

Release headline:

> First public foundation: assessment graph schema, dashboard sample, and
> honesty-gate fixtures.

Be explicit that the CLI/scanner is still roadmap work. That honesty will build
trust faster than overclaiming.

## Seed issues

Create these issues before launch so contributors have obvious paths:

1. `good first issue: add README screenshots from dashboard sample`
2. `good first issue: add more negative validator fixtures`
3. `scanner: implement TS/JS import graph extraction`
4. `cli: add assess validate command`
5. `dashboard: improve empty/not_assessed states`
6. `integration: GitHub Action prototype`
7. `docs: write intent-spec example for a real OSS repo`

## Launch channels

Start narrow. The right audience is developers already using coding agents and
feeling review/verification pain.

Suggested sequence:

1. GitHub public repo + v0.1.0 release.
2. Short demo post with one screenshot and one concrete finding.
3. Share in Claude Code / Cursor / agentic coding communities.
4. Ask for fixture repos and false-positive reports, not stars.
5. Only after CLI/scanner exists, submit to plugin marketplaces.

## What not to do

- Do not claim full repo assessment before the CLI/scanner exists.
- Do not claim security coverage unless security scanners are integrated.
- Do not hide unassessed areas in screenshots.
- Do not benchmark against UA as if `assess` solves the same job.
- Do not accept generated graphs that fail the honesty gate.

## Success metric for the next milestone

A skeptical user should be able to run one command on a small TS/JS repo and get:

- a valid `.assessment/assessment-graph.json`;
- a dashboard that opens locally;
- at least one useful, evidence-bound finding;
- a clear list of unassessed areas;
- no claim stronger than the evidence supports.
