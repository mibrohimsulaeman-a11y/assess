import {
  createEndpointNode,
  createEndpointObservation,
  createRouteEdge,
  dedupeById,
  dedupeObservations,
  emptyScanResult,
  isGo,
  lineNumberForOffset,
  normalizeHttpMethod,
  normalizeRoutePath,
  readText,
} from "./common.mjs";

const LIMITATIONS = [
  "Go HTTP pack only models common literal net/http, gorilla-style, and chi-style route forms",
  "Go HTTP pack does not resolve router groups or mounted subrouters",
  "Go HTTP pack does not infer middleware or auth semantics",
];

const HANDLE_FUNC_RE = /\b(?:http|mux)\.HandleFunc\s*\(\s*"([^"]+)"\s*,\s*([A-Za-z_]\w*)/g;
const METHODS_CHAIN_RE = /\b([A-Za-z_]\w*)\.HandleFunc\s*\(\s*"([^"]+)"\s*,\s*([A-Za-z_]\w*)\s*\)\s*\.Methods\s*\(\s*"([A-Z]+)"/g;
const CHI_METHOD_RE = /\b([A-Za-z_]\w*)\.(Get|Post|Put|Patch|Delete|Options|Head)\s*\(\s*"([^"]+)"\s*,\s*([A-Za-z_]\w*)/g;

export const goHttpFrameworkPack = {
  id: "go-http-v1",
  displayName: "Go HTTP framework pack",
  frameworkIds: ["Go net/http"],
  languageIds: ["Go"],
  limitations: LIMITATIONS,
  detect(context) {
    const routes = goHttpRoutes(context);
    const hasNetHttpImport = context.allFiles.some((file) => isGo(file.rel) && /"net\/http"/.test(readText(file)));
    const detected = hasNetHttpImport || routes.length > 0;
    return {
      detected,
      confidence: hasNetHttpImport && routes.length > 0 ? "HIGH" : routes.length > 0 ? "MED" : hasNetHttpImport ? "LOW" : "LOW",
      reasons: [
        ...(hasNetHttpImport ? ["Go import signal: net/http"] : []),
        ...(routes.length > 0 ? [`Go HTTP route matched ${routes.length} literal declaration(s)`] : []),
      ],
    };
  },
  scanRepo(context) {
    const detection = this.detect(context);
    const routes = goHttpRoutes(context);
    if (!detection.detected || routes.length === 0) return emptyScanResult(this, detection.detected, detection.confidence, detection.detected ? this.frameworkIds : []);

    const endpointNodes = [];
    const frameworkEdges = [];
    const observations = [];

    for (const route of routes) {
      const method = normalizeHttpMethod(route.method);
      const routePath = normalizeRoutePath(route.path);
      const endpointNode = createEndpointNode({
        frameworkId: "go-http",
        frameworkLabel: "Go HTTP",
        filePath: route.file.rel,
        method,
        routePath,
        line: route.line,
      });
      const fact = `${route.file.rel}:${route.line} declares Go HTTP route ${method.toUpperCase()} ${routePath}`;
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

function goHttpRoutes(context) {
  const out = [];
  for (const file of context.allFiles.filter((item) => isGo(item.rel))) {
    const content = readText(file);
    collectHandleFuncRoutes(out, context, file, content);
    collectMethodChainRoutes(out, context, file, content);
    collectChiStyleRoutes(out, context, file, content);
  }
  return out;
}

function collectHandleFuncRoutes(out, context, file, content) {
  HANDLE_FUNC_RE.lastIndex = 0;
  let match;
  while ((match = HANDLE_FUNC_RE.exec(content))) {
    out.push({ file, method: "all", path: match[1], line: lineNumberForOffset(content, match.index), sourceId: functionSource(context, file.rel, match[2]) || `file:${file.rel}` });
  }
}

function collectMethodChainRoutes(out, context, file, content) {
  METHODS_CHAIN_RE.lastIndex = 0;
  let match;
  while ((match = METHODS_CHAIN_RE.exec(content))) {
    out.push({ file, method: match[4], path: match[2], line: lineNumberForOffset(content, match.index), sourceId: functionSource(context, file.rel, match[3]) || `file:${file.rel}` });
  }
}

function collectChiStyleRoutes(out, context, file, content) {
  CHI_METHOD_RE.lastIndex = 0;
  let match;
  while ((match = CHI_METHOD_RE.exec(content))) {
    out.push({ file, method: match[2], path: match[3], line: lineNumberForOffset(content, match.index), sourceId: functionSource(context, file.rel, match[4]) || `file:${file.rel}` });
  }
}

function functionSource(context, rel, name) {
  const id = `function:${rel}:${name}`;
  return context.adapterScan.symbolById.has(id) ? id : null;
}
