import { z } from "zod";

// Runtime schema for assessment-graph.json. Mirrors types.ts. Used to validate
// what the pipeline writes before the dashboard ever reads it.

export const SeveritySchema = z.enum(["P0", "P1", "P2", "P3"]);
export const EvidenceStrengthSchema = z.enum(["verified", "inferred", "unverifiable"]);
export const GapDirectionSchema = z.enum(["intent_to_code", "code_to_intent", "baseline_to_code"]);
export const CoverageStatusSchema = z.enum([
  "assessed", "partial", "not_assessed", "coverage_insufficient",
]);
export const OwnershipStateSchema = z.enum([
  "owned", "shared", "infrastructure", "hidden", "overclaimed", "unowned",
]);

export const NodeTypeSchema = z.enum([
  "file", "function", "class", "module", "concept",
  "config", "document", "service", "table", "endpoint",
  "pipeline", "schema", "resource",
  "capability", "intent",
]);

export const EdgeTypeSchema = z.enum([
  "imports", "exports", "contains", "inherits", "implements",
  "calls", "reads_from", "writes_to", "depends_on", "tested_by", "configures", "routes",
  "owns", "realizes",
  "intent_to_code", "code_to_intent", "baseline_to_code",
]);

export const BindingSchema = z.object({
  assessedAtCommit: z.string(),
  intentSpecHash: z.string(),
  generated: z.string(),
});

export const SpanBindingSchema = z.object({
  filePath: z.string(),
  lineRange: z.tuple([z.number(), z.number()]),
  spanSha256: z.string(),
  normalizedFingerprint: z.string(),
});

export const EvidenceSchema = z.object({
  fact: z.string(),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  signals: z.array(z.string()).optional(),
  strength: EvidenceStrengthSchema,
  span: SpanBindingSchema.optional(),
});

export const MissingCodeProofSchema = z.object({
  result: z.enum(["absent", "not_found_in_index", "coverage_insufficient"]),
  searchedRoots: z.array(z.string()),
  excludedRoots: z.array(z.string()),
  requiredRecordTypes: z.array(z.enum(["symbol", "route", "call"])),
  coverage: z.object({ required: z.number(), actual: z.number() }),
  lowConfidenceResidues: z.array(z.string()),
  residuesRuledIrrelevant: z.array(z.string()),
});

export const NodeAssessmentSchema = z.object({
  coverageStatus: CoverageStatusSchema,
  ownership: OwnershipStateSchema,
  capabilityId: z.string().optional(),
  findingIds: z.array(z.string()),
  readiness: z.enum(["ready", "partial", "blocked", "unknown"]),
  worstSeverity: SeveritySchema.nullable().optional(),
  trust: EvidenceStrengthSchema.optional(),
  notAssessedReason: z.string().optional(),
});

export const IntentMetaSchema = z.object({
  status: z.enum(["CONFIRMED", "UNCONFIRMED"]),
  owns: z.array(z.string()).optional(),
  invariant: z.string().optional(),
  criticalPath: z.boolean().optional(),
});

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  name: z.string(),
  filePath: z.string().optional(),
  lineRange: z.tuple([z.number(), z.number()]).optional(),
  summary: z.string(),
  tags: z.array(z.string()),
  complexity: z.enum(["simple", "moderate", "complex"]),
  assessment: NodeAssessmentSchema.optional(),
  intentMeta: IntentMetaSchema.optional(),
});

export const EdgeGapSchema = z.object({
  direction: GapDirectionSchema,
  status: z.enum([
    "satisfied", "missing", "partial", "misaligned",
    "justified", "unexplained", "violation",
  ]),
  findingId: z.string().optional(),
});

export const GraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  type: EdgeTypeSchema,
  direction: z.enum(["forward", "backward", "bidirectional"]),
  weight: z.number().min(0).max(1),
  description: z.string().optional(),
  gap: EdgeGapSchema.optional(),
  evidence: z.object({ fact: z.string(), lowConfidence: z.boolean().optional() }).optional(),
});

export const FindingSchema = z.object({
  id: z.string(),
  direction: GapDirectionSchema,
  category: z.enum([
    "alignment.missing", "alignment.partial", "alignment.unexplained",
    "alignment.misalignment", "correctness", "quality",
  ]),
  claim: z.string(),
  evidence: EvidenceSchema,
  intentRef: z.string().optional(),
  severity: SeveritySchema,
  confidence: z.enum(["HIGH", "MED", "LOW"]),
  explanation: z.string(),
  recommendation: z.string(),
  missingCodeProof: MissingCodeProofSchema.optional(),
  targetNodeIds: z.array(z.string()),
  binding: BindingSchema.extend({
    spanSha256: z.string().optional(),
    normalizedFingerprint: z.string().optional(),
  }),
});

export const AreaSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  nodeIds: z.array(z.string()),
  coverageStatus: CoverageStatusSchema,
  worstSeverity: SeveritySchema.nullable().optional(),
});

export const CoverageManifestSchema = z.object({
  totalAreas: z.number(),
  totalNodes: z.number(),
  byStatus: z.record(z.number()),
  headlineTrust: EvidenceStrengthSchema,
  gaps: z.array(z.object({
    scope: z.string(),
    status: CoverageStatusSchema,
    reason: z.string(),
  })),
});

export const AssessmentGraphSchema = z.object({
  version: z.string(),
  kind: z.literal("assessment"),
  binding: BindingSchema,
  project: z.object({
    name: z.string(),
    languages: z.array(z.string()),
    frameworks: z.array(z.string()),
    description: z.string(),
    analyzedAt: z.string(),
    gitCommitHash: z.string(),
  }),
  intents: z.array(GraphNodeSchema),
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  findings: z.array(FindingSchema),
  areas: z.array(AreaSchema),
  coverage: CoverageManifestSchema,
  summary: z.object({
    bySeverity: z.record(z.number()),
    byCategory: z.record(z.number()),
    byDirection: z.record(z.number()),
    headline: z.string(),
  }),
});

export type AssessmentGraphParsed = z.infer<typeof AssessmentGraphSchema>;
