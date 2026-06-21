import { javascriptTypeScriptAdapter } from "./javascript.mjs";
import { pythonAdapter } from "./python.mjs";
import { goAdapter } from "./go.mjs";

export const runtimeLanguageAdapters = [
  javascriptTypeScriptAdapter,
  pythonAdapter,
  goAdapter,
];

export function scanWithAdapters(context, adapters = runtimeLanguageAdapters) {
  const aggregate = {
    assessedFiles: [],
    indexedFileCount: 0,
    componentNodes: [],
    factEdges: [],
    observations: [],
    fileExtracts: [],
    symbolById: new Map(),
    limitations: new Set(),
    adapterRuns: [],
  };

  for (const adapter of adapters) {
    const result = adapter.scanRepo(context);
    aggregate.assessedFiles.push(...result.assessedFiles);
    aggregate.indexedFileCount += result.indexedFileCount;
    aggregate.componentNodes.push(...result.componentNodes);
    aggregate.factEdges.push(...result.factEdges);
    aggregate.observations.push(...result.observations);
    aggregate.fileExtracts.push(...result.fileExtracts);
    for (const limitation of result.limitations || []) aggregate.limitations.add(limitation);
    for (const [id, symbol] of result.symbolById) aggregate.symbolById.set(id, symbol);
    aggregate.adapterRuns.push(toAdapterRunMeta(result));
  }

  return {
    ...aggregate,
    limitations: [...aggregate.limitations].sort(),
  };
}

function toAdapterRunMeta(result) {
  return {
    adapterId: result.adapterId,
    displayName: result.displayName,
    languageIds: result.languageIds,
    extensions: result.extensions,
    parserStrategy: result.parserStrategy,
    assessedFileCount: result.assessedFiles.length,
    indexedFileCount: result.indexedFileCount,
    componentNodeCount: result.componentNodes.length,
    factEdgeCount: result.factEdges.length,
    observationCount: result.observations.length,
    limitations: [...(result.limitations || [])].sort(),
  };
}
