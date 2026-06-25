import {
  createEndpointNode,
  createEndpointObservation,
  createRouteEdge,
  dedupeById,
  dedupeObservations,
  emptyScanResult,
  hasPackageDependency,
  isJavaScriptLike,
  normalizeHttpMethod,
  normalizeRoutePath,
} from "./common.mjs";

const LIMITATIONS = [
  "Express/Fastify pack only models literal route paths already extracted by the JS/TS adapter",
  "Express/Fastify pack does not resolve dynamic route path composition",
  "Express/Fastify pack does not model middleware order, auth semantics, or handler body behavior",
];

export const expressFrameworkPack = {
  id: "express-v1",
  displayName: "Express/Fastify framework pack",
  frameworkIds: ["Express", "Fastify"],
  languageIds: ["JavaScript", "TypeScript"],
  limitations: LIMITATIONS,
  detect(context) {
    const hasExpress = hasPackageDependency(context.repoRoot, "express");
    const hasFastify = hasPackageDependency(context.repoRoot, "fastify");
    const routeCount = jsRouteExtracts(context).reduce((sum, extract) => sum + extract.routes.length, 0);
    const detected = hasExpress || hasFastify || routeCount > 0;
    return {
      detected,
      confidence: hasExpress || hasFastify ? "HIGH" : routeCount > 0 ? "MED" : "LOW",
      reasons: [
        ...(hasExpress ? ["package.json dependency: express"] : []),
        ...(hasFastify ? ["package.json dependency: fastify"] : []),
        ...(routeCount > 0 ? [`JS/TS adapter extracted ${routeCount} literal route declaration(s)`] : []),
      ],
    };
  },
  scanRepo(context) {
    const detection = this.detect(context);
    if (!detection.detected) return emptyScanResult(this, false, detection.confidence, []);

    const hasFastify = hasPackageDependency(context.repoRoot, "fastify");
    const hasExpress = hasPackageDependency(context.repoRoot, "express");
    const frameworkId = hasFastify && !hasExpress ? "fastify" : "express";
    const frameworkLabel = frameworkId === "fastify" ? "Fastify" : "Express";
    const frameworkIds = [frameworkLabel];
    const endpointNodes = [];
    const frameworkEdges = [];
    const observations = [];

    for (const extract of jsRouteExtracts(context)) {
      const filePath = extract.fileId.replace(/^file:/, "");
      for (const route of extract.routes) {
        const method = normalizeHttpMethod(route.method);
        const routePath = normalizeRoutePath(route.path);
        const endpointNode = createEndpointNode({
          frameworkId,
          frameworkLabel,
          filePath,
          method,
          routePath,
          line: route.line,
        });
        const fact = `${filePath}:${route.line} declares ${frameworkLabel} route ${method.toUpperCase()} ${routePath}`;
        endpointNodes.push(endpointNode);
        frameworkEdges.push(createRouteEdge({
          sourceId: extract.fileId,
          endpointNode,
          evidenceFact: fact,
        }));
        observations.push(createEndpointObservation({
          endpointNode,
          evidenceFact: fact,
          sourceSha256: context.sourceSha256,
          normalizedFingerprint: context.normalizedFingerprint,
        }));
      }
    }

    return {
      packId: this.id,
      displayName: this.displayName,
      frameworkIds,
      languageIds: this.languageIds,
      detected: true,
      confidence: detection.confidence,
      endpointNodes: dedupeById(endpointNodes),
      resourceNodes: [],
      configNodes: [],
      frameworkEdges: dedupeById(frameworkEdges),
      observations: dedupeObservations(observations),
      limitations: LIMITATIONS,
    };
  },
};

function jsRouteExtracts(context) {
  return (context.adapterScan.fileExtracts || []).filter((extract) => {
    const filePath = extract.fileId.replace(/^file:/, "");
    return isJavaScriptLike(filePath) && Array.isArray(extract.routes) && extract.routes.length > 0;
  });
}
