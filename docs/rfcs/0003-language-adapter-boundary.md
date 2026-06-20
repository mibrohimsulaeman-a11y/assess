# RFC 0003 — Language Adapter Boundary

## Status

Accepted for M3.1.

## Context

The original runtime scanner lived directly inside `packages/core/runtime/engine.mjs`.
That was acceptable for the TS/JS MVP, but it made multi-language support risky:
new languages would have to edit the graph assembly and gap-signal engine instead
of contributing isolated extraction logic.

M3.1 introduces a boundary where language adapters produce deterministic scan
facts, while `engine.mjs` remains responsible for graph assembly, coverage,
candidate signal generation, and validation.

## Contract

Typed contract files:

```text
packages/core/src/adapters/language-adapter.ts
packages/core/src/adapters/scan-result.ts
```

Runtime adapter shape:

```text
LanguageAdapter.scanRepo(context) -> LanguageAdapterScanResult
```

A scan result contains:

| Field | Meaning |
|---|---|
| `assessedFiles` | files handled by the adapter |
| `indexedFileCount` | files actually read and indexed |
| `componentNodes` | file/symbol nodes emitted by the adapter |
| `factEdges` | deterministic structural edges such as contains/imports |
| `observations` | symbol-level evidence used by baseline and intent gap logic |
| `symbolById` | lookup for intent expected component matching |
| `limitations` | explicit scanner blind spots used in absence proofs |

## Runtime implementation

Current production adapter:

```text
packages/core/runtime/adapters/javascript.mjs
```

It preserves the existing JavaScript/TypeScript regex + brace matching behavior.
The graph output contract is intentionally unchanged.

## Non-goals

M3.1 does not add Python/Go/Rust support.
M3.1 does not add Tree-sitter.
M3.1 does not claim behavioral partial/misaligned analysis.
M3.1 does not change the reviewed graph/report gate.

## Acceptance criteria

- `engine.mjs` no longer owns JS/TS symbol extraction directly.
- JS/TS extraction remains zero-dependency and runnable with plain `node`.
- Output graph validation remains green.
- Adapter boundary fixture proves file nodes, symbol nodes, import edges, test-file tagging, and scanner limitations.
- New languages must add adapters and fixtures instead of editing graph assembly directly.

## Next slice

M3.2 should add an adapter registry/resolution layer and make adapter coverage
visible in graph metadata, still without changing user-facing findings semantics.
