# assess contributor notes

## Commands

Zero-dependency checks:

```bash
node packages/core/test/run-fixtures.cjs
node packages/core/scripts/validate-graph.cjs packages/dashboard/public/assessment-graph.json
```

Workspace checks after dependency install:

```bash
pnpm install
pnpm test
pnpm build
pnpm dev:dashboard
```

## Architecture

- `packages/core/src/types.ts` and `schema.ts` define the public graph contract.
- `packages/core/src/overlay/validate.ts` is the source validator.
- `packages/core/scripts/validate-graph.cjs` mirrors critical validator rules with
  zero dependencies for CI/bootstrap.
- `packages/dashboard` must only rely on browser-safe graph data.
- `skills/assess/SKILL.md` describes the intended agent workflow; it must not
  promise behavior the local code cannot eventually enforce.

## Non-negotiable rules

1. `assess` is read-only against target repos.
2. Missing-code findings require proof; unproven absence is not absence.
3. Every assessable node must receive a coverage status.
4. Severity must be capped by evidence strength, intent confirmation, and proof
   quality.
5. Do not weaken the zero-dependency validator without adding an equivalent
   fixture.
