import {
  createEndpointNode,
  createEndpointObservation,
  createRouteEdge,
  dedupeById,
  dedupeObservations,
  emptyScanResult,
  hasPackageDependency,
  isJavaScriptLike,
  pathSegmentsToRoute,
  readText,
} from "./common.mjs";

const LIMITATIONS = [
  "Next.js pack models App Router route files and Pages API files only",
  "Next.js pack does not infer dynamic route params beyond file path segments",
  "Next.js pack does not inspect handler-level method dispatch for Pages API routes",
  "Next.js pack does not model middleware.ts behavior",
];

const HTTP_EXPORT_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*\(|export\s+const\s+(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s*=/g;

export const nextJsFrameworkPack = {
  id: "nextjs-v1",
  displayName: "Next.js framework pack",
  frameworkIds: ["Next.js"],
  languageIds: ["JavaScript", "TypeScript"],
  limitations: LIMITATIONS,
  detect(context) {
    const hasNext = hasPackageDependency(context.repoRoot, "next");
    const conventionCount = nextRouteFiles(context).length;
    const detected = hasNext || conventionCount > 0;
    return {
      detected,
      confidence: hasNext ? "HIGH" : conventionCount > 0 ? "MED" : "LOW",
      reasons: [
        ...(hasNext ? ["package.json dependency: next"] : []),
        ...(conventionCount > 0 ? [`Next.js route file convention matched ${conventionCount} file(s)`] : []),
      ],
    };
  },
  scanRepo(context) {
    const detection = this.detect(context);
    const files = nextRouteFiles(context);
    if (!detection.detected || files.length === 0) return emptyScanResult(this, detection.detected, detection.confidence, detection.detected ? this.frameworkIds : []);

    const endpointNodes = [];
    const frameworkEdges = [];
    const observations = [];

    for (const routeFile of files) {
      const content = readText(routeFile.file);
      const methods = routeFile.kind === "app-router" ? extractAppRouterMethods(content) : ["all"];
      for (const method of methods) {
        const endpointNode = createEndpointNode({
          frameworkId: "nextjs",
          frameworkLabel: "Next.js",
          filePath: routeFile.file.rel,
          method,
          routePath: routeFile.routePath,
          line: method === "all" ? 1 : lineForMethodExport(content, method),
        });
        const fact = `${routeFile.file.rel}:${endpointNode.lineRange?.[0] ?? 1} declares Next.js ${routeFile.kind} route ${method.toUpperCase()} ${routeFile.routePath}`;
        endpointNodes.push(endpointNode);
        frameworkEdges.push(createRouteEdge({
          sourceId: `file:${routeFile.file.rel}`,
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
      frameworkIds: this.frameworkIds,
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

function nextRouteFiles(context) {
  const out = [];
  for (const file of context.allFiles) {
    if (!isJavaScriptLike(file.rel)) continue;
    const appMatch = /^app\/(.*)\/route\.[^.]+$/.exec(file.rel) || /^app\/route\.[^.]+$/.exec(file.rel);
    if (appMatch) {
      const segmentText = appMatch[1] || "";
      out.push({ file, kind: "app-router", routePath: pathSegmentsToRoute(segmentText ? segmentText.split("/") : []) });
      continue;
    }
    const pagesMatch = /^pages\/api\/(.*)\.[^.]+$/.exec(file.rel);
    if (pagesMatch) {
      const segments = pagesMatch[1].split("/");
      if (segments[segments.length - 1] === "index") segments.pop();
      out.push({ file, kind: "pages-api", routePath: pathSegmentsToRoute(["api", ...segments]) });
    }
  }
  return out;
}

function extractAppRouterMethods(content) {
  const methods = new Set();
  HTTP_EXPORT_RE.lastIndex = 0;
  let match;
  while ((match = HTTP_EXPORT_RE.exec(content))) methods.add(String(match[1] || match[2]).toLowerCase());
  return methods.size ? [...methods] : ["all"];
}

function lineForMethodExport(content, method) {
  const escaped = method.toUpperCase();
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${escaped}\\s*\\(|export\\s+const\\s+${escaped}\\s*=`, "g");
  const match = re.exec(content);
  return match ? content.slice(0, match.index).split(/\r?\n/).length : 1;
}
