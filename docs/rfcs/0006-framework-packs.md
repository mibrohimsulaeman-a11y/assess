# RFC 0006 — Framework Packs

## Status

Accepted for M6 implementation.

## Objective

`assess` must represent framework-level architecture facts without turning those
facts into final findings. Language adapters continue to produce files, symbols,
imports, observations, and low-level route facts. Framework packs consume that
adapter output plus source file conventions, then emit endpoint/resource/config
nodes and framework edges.

```text
language adapters
  -> file/symbol facts
  -> framework packs
  -> endpoint/resource/config facts
  -> graph assembly
  -> candidateSignals only
```

## Boundary

Framework packs are deterministic fact producers. They must not claim behavioral
correctness, auth/RBAC coverage, request/response schema validity, business
semantics, or final findings.

| Layer | Responsibility |
|---|---|
| Language adapter | file, function, class, import, parser limitations |
| Framework pack | framework conventions and literal endpoint/config/resource facts |
| Engine | orchestration, graph assembly, candidate signal policy, validation |
| Agent/human review | semantic assessment nodes and final findings |

## Runtime contract

Each pack receives the repo root, enumerated files, aggregated language adapter
scan result, language helper, and fingerprint helpers. Each pack returns:

- `endpointNodes`
- `resourceNodes`
- `configNodes`
- `frameworkEdges`
- low-significance runtime observations for framework facts
- `limitations`
- run metadata surfaced as `artifact.frameworkRuns[]`

## M6 supported packs

| Pack | Supported facts | Explicit non-goals |
|---|---|---|
| Express/Fastify | literal JS/TS route facts extracted by the JS/TS adapter | route composition, middleware ordering, auth semantics |
| Next.js | App Router `app/**/route.*`, Pages API `pages/api/**` | UI page routes, middleware behavior, handler method dispatch |
| FastAPI | literal decorators like `@app.get("/x")` and `@router.post("/x")` | APIRouter prefix composition, dependencies, auth, response models |
| Go HTTP | common literal `net/http`, gorilla-style, and chi-style handlers | mounted subrouters, router groups, middleware/auth semantics |

## Manifest

`artifact.frameworkRuns[]` is an honesty manifest. It records which packs ran,
what they detected, how many facts they emitted, and their limitations. Absence
of a framework run means no supported framework fact was detected by M6 packs;
it does not prove the framework is absent.

## Candidate policy

M6 framework packs produce facts only. They do not emit “endpoint missing auth,”
“route has no tests,” or similar framework-specific defect claims. Those require
semantic review and deeper behavioral analysis.
