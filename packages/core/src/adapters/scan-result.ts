import type {
  Confidence,
  EvidenceStrength,
  FindingCategory,
  GraphEdge,
  GraphNode,
  Severity,
  SpanBinding,
} from "../types.js";

export interface SourceFileRecord {
  abs: string;
  rel: string;
  bytes: number;
}

export interface ExtractedRoute {
  method: string;
  path: string;
  line: number;
}

export interface ExtractedSymbol {
  id: string;
  type: "function" | "class";
  name: string;
  filePath: string;
  lineRange: [number, number];
  exported: boolean;
  loc: number;
  complexity: "simple" | "moderate" | "complex";
  source: string;
}

export interface FileExtract {
  fileId: string;
  imports: string[];
  routes: ExtractedRoute[];
  symbols: ExtractedSymbol[];
}

export interface BaselineViolation {
  rule: string;
  ruleSeverity: Severity;
  securitySensitive: boolean;
  fact: string;
  category: Extract<FindingCategory, "correctness" | "quality">;
}

export interface RuntimeObservation {
  nodeId: string;
  significance: "high" | "low";
  evidenceFact: string;
  evidenceStrength: EvidenceStrength;
  confidence: Confidence;
  baselineViolations: BaselineViolation[];
  span: SpanBinding;
}

export interface LanguageAdapterScanSummary {
  adapterId: string;
  displayName: string;
  languageIds: string[];
  extensions: string[];
  parserStrategy: string;
  assessedFileCount: number;
  indexedFileCount: number;
  componentNodeCount: number;
  factEdgeCount: number;
  observationCount: number;
  limitations: string[];
}

export interface LanguageAdapterScanResult {
  adapterId: string;
  displayName: string;
  languageIds: string[];
  extensions: string[];
  parserStrategy: string;
  assessedFiles: SourceFileRecord[];
  indexedFileCount: number;
  componentNodes: GraphNode[];
  factEdges: GraphEdge[];
  observations: RuntimeObservation[];
  fileExtracts: FileExtract[];
  symbolById: Map<string, ExtractedSymbol>;
  limitations: string[];
}
