// @assess/core — typed public surface
//
// Executable source of truth: packages/core/runtime/engine.mjs.
// This package exports graph contracts, schemas, validators, deterministic
// fact-layer helpers, and typed reference utilities. The helpers under src/**
// are not the production scanner/runtime pipeline by themselves; validate any
// assembled graph with the zero-dependency validator before publishing it.

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

// review decision workflow
export * from "./review/decision-types.js";
export * from "./review/apply-review-decisions.js";

// adapter boundary
export * from "./adapters/scan-result.js";
export * from "./adapters/language-adapter.js";

// framework pack boundary
export * from "./frameworks/scan-result.js";
export * from "./frameworks/framework-pack.js";
