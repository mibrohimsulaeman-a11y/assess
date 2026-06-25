import { expressFrameworkPack } from "./express.mjs";
import { nextJsFrameworkPack } from "./nextjs.mjs";
import { fastApiFrameworkPack } from "./fastapi.mjs";
import { goHttpFrameworkPack } from "./go-http.mjs";

export const runtimeFrameworkPacks = [
  expressFrameworkPack,
  nextJsFrameworkPack,
  fastApiFrameworkPack,
  goHttpFrameworkPack,
];

export function scanWithFrameworkPacks(context, packs = runtimeFrameworkPacks) {
  const aggregate = {
    endpointNodes: [],
    resourceNodes: [],
    configNodes: [],
    frameworkEdges: [],
    observations: [],
    limitations: new Set(),
    frameworkRuns: [],
  };

  for (const pack of packs) {
    const result = pack.scanRepo(context);
    const includeRun = shouldIncludeRun(result);
    aggregate.endpointNodes.push(...(result.endpointNodes || []));
    aggregate.resourceNodes.push(...(result.resourceNodes || []));
    aggregate.configNodes.push(...(result.configNodes || []));
    aggregate.frameworkEdges.push(...(result.frameworkEdges || []));
    aggregate.observations.push(...(result.observations || []));
    if (includeRun) {
      for (const limitation of result.limitations || []) aggregate.limitations.add(limitation);
      aggregate.frameworkRuns.push(toFrameworkRunMeta(result));
    }
  }

  return {
    ...aggregate,
    limitations: [...aggregate.limitations].sort(),
  };
}

function shouldIncludeRun(result) {
  return Boolean(
    result.detected ||
    (result.endpointNodes || []).length ||
    (result.resourceNodes || []).length ||
    (result.configNodes || []).length ||
    (result.frameworkEdges || []).length,
  );
}

function toFrameworkRunMeta(result) {
  return {
    packId: result.packId,
    displayName: result.displayName,
    frameworkIds: result.frameworkIds,
    languageIds: result.languageIds,
    detected: Boolean(result.detected),
    confidence: result.confidence,
    endpointNodeCount: (result.endpointNodes || []).length,
    resourceNodeCount: (result.resourceNodes || []).length,
    configNodeCount: (result.configNodes || []).length,
    frameworkEdgeCount: (result.frameworkEdges || []).length,
    observationCount: (result.observations || []).length,
    limitations: [...(result.limitations || [])].sort(),
  };
}
