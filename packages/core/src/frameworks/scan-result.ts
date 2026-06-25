import type {
  Confidence,
  FrameworkPackRunMeta,
  GraphEdge,
  GraphNode,
} from "../types.js";
import type {
  ExtractedSymbol,
  FileExtract,
  LanguageAdapterScanSummary,
  RuntimeObservation,
  SourceFileRecord,
} from "../adapters/scan-result.js";

export interface AggregatedLanguageAdapterScanResult {
  assessedFiles: SourceFileRecord[];
  indexedFileCount: number;
  componentNodes: GraphNode[];
  factEdges: GraphEdge[];
  observations: RuntimeObservation[];
  fileExtracts: FileExtract[];
  symbolById: Map<string, ExtractedSymbol>;
  limitations: string[];
  adapterRuns: LanguageAdapterScanSummary[];
}

export interface FrameworkPackDetection {
  detected: boolean;
  confidence: Confidence;
  reasons: string[];
}

export interface FrameworkPackScanResult {
  packId: string;
  displayName: string;
  frameworkIds: string[];
  languageIds: string[];
  detected: boolean;
  confidence: Confidence;
  endpointNodes: GraphNode[];
  resourceNodes: GraphNode[];
  configNodes: GraphNode[];
  frameworkEdges: GraphEdge[];
  observations: RuntimeObservation[];
  limitations: string[];
}

export interface AggregatedFrameworkPackScanResult {
  endpointNodes: GraphNode[];
  resourceNodes: GraphNode[];
  configNodes: GraphNode[];
  frameworkEdges: GraphEdge[];
  observations: RuntimeObservation[];
  limitations: string[];
  frameworkRuns: FrameworkPackRunMeta[];
}
