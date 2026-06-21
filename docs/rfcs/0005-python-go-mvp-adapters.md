# RFC 0005 — Python and Go MVP Adapters

## Status

Accepted for M5 MVP.

## Context

After the adapter boundary, assess can add language coverage without modifying
`runtime/engine.mjs`. M5 introduces minimal Python and Go adapters that produce
file/symbol facts and baseline candidate signals while staying honest about their
limitations.

## Runtime adapters

```text
packages/core/runtime/adapters/python.mjs
packages/core/runtime/adapters/go.mjs
```

## Python MVP

Extracts:

- `.py` files;
- classes;
- functions;
- class methods;
- simple import statements;
- test-file tags for common `test_*.py`, `*_test.py`, `tests/`, and `__tests__/` paths.

Limitations:

- no dynamic import resolution;
- no monkey-patch analysis;
- no call graph.

## Go MVP

Extracts:

- `.go` files;
- functions;
- methods with receivers, reported by method name;
- simple import declarations;
- `_test.go` tags.

Limitations:

- no build tag handling;
- no generated-code convention handling;
- no call graph.

## Artifact manifest

Every runtime graph may include:

```text
artifact.adapterRuns[]
```

Each entry states adapter id, display name, languages, extensions, parser
strategy, indexed file counts, fact counts, observation counts, and limitations.

## Acceptance criteria

- Multi-language runtime fixture scans TS, Python, and Go in one run.
- Graph remains validator-clean.
- Final findings remain empty until semantic review.
- Candidate/report/dashboard gates remain unchanged.
