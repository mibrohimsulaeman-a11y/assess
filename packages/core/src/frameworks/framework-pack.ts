import type { SourceFileRecord } from "../adapters/scan-result.js";
import type {
  AggregatedLanguageAdapterScanResult,
  FrameworkPackDetection,
  FrameworkPackScanResult,
} from "./scan-result.js";

export interface FrameworkPackContext {
  repoRoot: string;
  allFiles: SourceFileRecord[];
  adapterScan: AggregatedLanguageAdapterScanResult;
  langOf: (path: string) => string;
  sourceSha256: (source: string) => string;
  normalizedFingerprint: (source: string) => string;
}

export interface FrameworkPack {
  id: string;
  displayName: string;
  frameworkIds: string[];
  languageIds: string[];
  detect(context: FrameworkPackContext): FrameworkPackDetection;
  scanRepo(context: FrameworkPackContext): FrameworkPackScanResult;
}
