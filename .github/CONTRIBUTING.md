# Contributing to assess

Thanks for helping build `assess`. The project is early, so high-quality small
changes are more useful than broad rewrites.

## Project principles

1. **Read-only by default.** `assess` must not edit the target codebase.
2. **Evidence before judgment.** A finding must cite deterministic evidence or a
   bounded missing-code proof.
3. **Coverage must be explicit.** Unassessed areas are part of the result.
4. **No overclaiming.** Severity and trust must be capped by the weakest proof.
5. **Public UX matters.** A new user should understand the value from README,
   sample graph, and dashboard in under five minutes.

## Local checks

Run the zero-dependency smoke checks first:

```bash
pnpm ci:smoke
```

Or without pnpm:

```bash
node packages/core/test/run-fixtures.cjs
node packages/core/scripts/validate-graph.cjs packages/dashboard/public/assessment-graph.json
```

Then run the full workspace checks after installing dependencies:

```bash
pnpm install
pnpm test
pnpm build
```

## Pull request expectations

A PR should include:

- a clear problem statement;
- tests or fixtures for any validator/assessment change;
- updated docs if the public contract changes;
- no generated dependency or dashboard artifacts unless explicitly needed.

## Good first issues

Good first contributions usually fit one of these buckets:

- add negative validator fixtures;
- improve dashboard readability without changing graph semantics;
- add small TS/JS scanner fixtures;
- document an assessment example;
- tighten wording that could overclaim evidence strength.

## Design changes

Open an issue before changing graph schema, severity rules, missing-code proof
semantics, or plugin invocation behavior. These are public contracts.
