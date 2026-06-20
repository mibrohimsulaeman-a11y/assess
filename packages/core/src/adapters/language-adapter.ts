import type { LanguageAdapterScanResult, SourceFileRecord } from "./scan-result.js";

export interface LanguageAdapterContext {
  repoRoot: string;
  allFiles: SourceFileRecord[];
  langOf: (path: string) => string;
  sourceSha256: (source: string) => string;
  normalizedFingerprint: (source: string) => string;
}

export interface LanguageAdapter {
  id: string;
  displayName: string;
  languageIds: string[];
  extensions: string[];
  /** Known extraction blind spots that must cap absence claims and be shown honestly. */
  limitations: string[];
  scanRepo(context: LanguageAdapterContext): LanguageAdapterScanResult;
}
