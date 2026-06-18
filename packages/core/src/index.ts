// @assess/core — public surface
//
// Fact layer (deterministic):   scan, index-builder, fingerprint
// Intent model (should-be):     intent-spec
// Assessment engine (judgment): gap-engine, missing-code-proof, severity, coverage
// Overlay (graph assembly):     assemble, validate
//
// The pipeline (skills/assess/SKILL.md) drives these in order and writes
// .assessment/assessment-graph.json, which the dashboard renders.

export * from "./types.js";
export {
  AssessmentGraphSchema,
  type AssessmentGraphParsed,
} from "./schema.js";

// fact layer
export * from "./fact-layer/scan.js";
export * from "./fact-layer/index-builder.js";
export * from "./fact-layer/fingerprint.js";

// intent
export * from "./intent/intent-spec.js";

// assessment engine
export * from "./assess/severity.js";
export * from "./assess/missing-code-proof.js";
export * from "./assess/coverage.js";
export * from "./assess/gap-engine.js";

// overlay
export * from "./overlay/assemble.js";
export * from "./overlay/validate.js";
