# RFC 0004 — Parser-backed JS/TS Adapter Step

## Status

Accepted for M4A.

## Context

The roadmap names Tree-sitter for the JS/TS extraction upgrade. Tree-sitter
packages are not present in the current local dependency set, and the runtime must
continue to work before optional dependencies are installed.

M4A therefore introduces a parser-strategy layer inside the JS/TS adapter:

- use the local `typescript` compiler API when available;
- fall back to the zero-dependency regex/brace scanner when it is not available;
- stamp the parser strategy in `artifact.adapterRuns`.

This is an AST-backed improvement, not a Tree-sitter completion claim.

## Runtime behavior

```text
javascript.mjs
  -> typescript-compiler-api when available
  -> regex-brace-fallback otherwise
```

The TypeScript parser extracts:

- import declarations;
- `require()` module references;
- top-level function declarations;
- class declarations;
- class methods;
- exported const arrow/function expressions;
- simple HTTP route calls on known router/app receivers.

## Non-goals

- No call graph.
- No behavioral partial/misaligned analysis.
- No dynamic import or re-export resolution.
- No claim that Tree-sitter is implemented.

## Acceptance criteria

- JS/TS adapter remains runnable with plain `node` through fallback.
- When TypeScript is installed, parser strategy is `typescript-compiler-api`.
- Runtime output remains candidate-only.
- Existing graph validation and MCP contract stay green.

## Next Tree-sitter slice

A future M4B can replace or supplement the TypeScript parser strategy with real
Tree-sitter packages once dependency and packaging decisions are explicit.
