import {
  createEndpointNode,
  createEndpointObservation,
  createRouteEdge,
  dedupeById,
  dedupeObservations,
  emptyScanResult,
  isPython,
  lineNumberForOffset,
  normalizeHttpMethod,
  normalizeRoutePath,
  readRepoFile,
  readText,
} from "./common.mjs";

const LIMITATIONS = [
  "FastAPI pack only models literal decorator route paths",
  "FastAPI pack does not resolve APIRouter prefix composition or include_router mounting",
  "FastAPI pack does not inspect dependency injection, auth, or response models",
];

const DECORATOR_RE = /^\s*@([A-Za-z_]\w*(?:_router|router|app)?|[A-Za-z_]\w*\.router)\.(get|post|put|patch|delete|options|head)\s*\(\s*["']([^"']+)["']/gm;

export const fastApiFrameworkPack = {
  id: "fastapi-v1",
  displayName: "FastAPI framework pack",
  frameworkIds: ["FastAPI"],
  languageIds: ["Python"],
  limitations: LIMITATIONS,
  detect(context) {
    const dependencySignal = hasFastApiDependencySignal(context);
    const decoratorCount = fastApiDecorators(context).length;
    const detected = dependencySignal || decoratorCount > 0;
    return {
      detected,
      confidence: dependencySignal ? "HIGH" : decoratorCount > 0 ? "MED" : "LOW",
      reasons: [
        ...(dependencySignal ? ["FastAPI dependency/import signal found"] : []),
        ...(decoratorCount > 0 ? [`FastAPI decorator route matched ${decoratorCount} declaration(s)`] : []),
      ],
    };
  },
  scanRepo(context) {
    const detection = this.detect(context);
    const decorators = fastApiDecorators(context);
    if (!detection.detected || decorators.length === 0) return emptyScanResult(this, detection.detected, detection.confidence, detection.detected ? this.frameworkIds : []);

    const endpointNodes = [];
    const frameworkEdges = [];
    const observations = [];

    for (const route of decorators) {
      const method = normalizeHttpMethod(route.method);
      const routePath = normalizeRoutePath(route.path);
      const endpointNode = createEndpointNode({
        frameworkId: "fastapi",
        frameworkLabel: "FastAPI",
        filePath: route.file.rel,
        method,
        routePath,
        line: route.line,
      });
      const fact = `${route.file.rel}:${route.line} declares FastAPI route ${method.toUpperCase()} ${routePath}`;
      endpointNodes.push(endpointNode);
      frameworkEdges.push(createRouteEdge({
        sourceId: route.sourceId,
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

function hasFastApiDependencySignal(context) {
  const requirements = readRepoFile(context.repoRoot, "requirements.txt");
  const pyproject = readRepoFile(context.repoRoot, "pyproject.toml");
  if (/\bfastapi\b/i.test(`${requirements}\n${pyproject}`)) return true;
  return context.allFiles.some((file) => isPython(file.rel) && /\b(from\s+fastapi\s+import|import\s+fastapi)\b/.test(readText(file)));
}

function fastApiDecorators(context) {
  const out = [];
  for (const file of context.allFiles.filter((item) => isPython(item.rel))) {
    const content = readText(file);
    DECORATOR_RE.lastIndex = 0;
    let match;
    while ((match = DECORATOR_RE.exec(content))) {
      const receiver = match[1];
      if (!isFastApiReceiver(receiver)) continue;
      const line = lineNumberForOffset(content, match.index);
      out.push({
        file,
        method: match[2],
        path: match[3],
        line,
        sourceId: functionSourceAfterDecorator(context, file.rel, line) || `file:${file.rel}`,
      });
    }
  }
  return out;
}

function isFastApiReceiver(receiver) {
  return receiver === "app" || receiver === "router" || /(?:^|_)router$/i.test(receiver) || /\.router$/i.test(receiver);
}

function functionSourceAfterDecorator(context, rel, decoratorLine) {
  for (const symbol of context.adapterScan.symbolById.values()) {
    if (symbol.filePath !== rel || symbol.type !== "function") continue;
    if (symbol.lineRange[0] >= decoratorLine && symbol.lineRange[0] <= decoratorLine + 4) return symbol.id;
  }
  return null;
}
