import fs from "node:fs";
import path from "node:path";

export const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all", "use"]);

export function extensionOf(rel) {
  return rel.split(".").pop()?.toLowerCase() ?? "";
}

export function isJavaScriptLike(rel) {
  return new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]).has(extensionOf(rel));
}

export function isPython(rel) {
  return extensionOf(rel) === "py";
}

export function isGo(rel) {
  return extensionOf(rel) === "go";
}

export function readText(file) {
  try {
    return fs.readFileSync(file.abs, "utf8");
  } catch {
    return "";
  }
}

export function readRepoFile(repoRoot, rel) {
  try {
    return fs.readFileSync(path.join(repoRoot, rel), "utf8");
  } catch {
    return "";
  }
}

export function packageDependencies(repoRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
    return { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}), ...(pkg.peerDependencies || {}) };
  } catch {
    return {};
  }
}

export function hasPackageDependency(repoRoot, name) {
  return Boolean(packageDependencies(repoRoot)[name]);
}

export function normalizeHttpMethod(method) {
  return String(method || "all").toLowerCase();
}

export function normalizeRoutePath(routePath) {
  const raw = String(routePath || "/").trim() || "/";
  return raw.startsWith("/") ? raw : `/${raw}`;
}

export function endpointId(frameworkId, filePath, method, routePath) {
  return `endpoint:${frameworkId}:${filePath}:${normalizeHttpMethod(method)}:${normalizeRoutePath(routePath)}`;
}

export function createEndpointNode({ frameworkId, frameworkLabel, filePath, method, routePath, line }) {
  const normalizedMethod = normalizeHttpMethod(method);
  const normalizedPath = normalizeRoutePath(routePath);
  const displayMethod = normalizedMethod.toUpperCase();
  return {
    id: endpointId(frameworkId, filePath, normalizedMethod, normalizedPath),
    type: "endpoint",
    name: `${displayMethod} ${normalizedPath}`,
    filePath,
    lineRange: Number.isFinite(line) ? [line, line] : undefined,
    summary: `${frameworkLabel} route ${displayMethod} ${normalizedPath} declared in ${filePath}${Number.isFinite(line) ? `:${line}` : ""}`,
    tags: [`framework:${frameworkId}`, "http", "route", `method:${normalizedMethod}`],
    complexity: "simple",
  };
}

export function createRouteEdge({ sourceId, endpointNode, evidenceFact }) {
  return {
    id: `edge:routes:${sourceId}->${endpointNode.id}`,
    source: sourceId,
    target: endpointNode.id,
    type: "routes",
    direction: "forward",
    weight: 0.9,
    evidence: { fact: evidenceFact },
  };
}

export function createEndpointObservation({ endpointNode, evidenceFact, sourceSha256, normalizedFingerprint }) {
  const spanSource = evidenceFact;
  return {
    nodeId: endpointNode.id,
    significance: "low",
    evidenceFact,
    evidenceStrength: "verified",
    confidence: "HIGH",
    baselineViolations: [],
    span: {
      filePath: endpointNode.filePath,
      lineRange: endpointNode.lineRange || [1, 1],
      spanSha256: sourceSha256(spanSource),
      normalizedFingerprint: normalizedFingerprint(spanSource),
    },
  };
}

export function dedupeById(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    if (!item || !item.id || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

export function dedupeObservations(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = `${item?.nodeId || ""}:${item?.evidenceFact || ""}`;
    if (!item || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function pathSegmentsToRoute(segments) {
  const converted = segments
    .filter((segment) => segment && !/^\(.+\)$/.test(segment))
    .map((segment) => {
      if (/^\[\.\.\.[^\]]+\]$/.test(segment)) return `:${segment.slice(4, -1)}*`;
      if (/^\[\[\.\.\.[^\]]+\]\]$/.test(segment)) return `:${segment.slice(5, -2)}*`;
      if (/^\[[^\]]+\]$/.test(segment)) return `:${segment.slice(1, -1)}`;
      return segment;
    });
  return normalizeRoutePath(converted.join("/"));
}

export function lineNumberForOffset(content, offset) {
  return content.slice(0, offset).split(/\r?\n/).length;
}

export function emptyScanResult(pack, detected = false, confidence = "LOW", frameworkIds = pack.frameworkIds) {
  return {
    packId: pack.id,
    displayName: pack.displayName,
    frameworkIds,
    languageIds: pack.languageIds,
    detected,
    confidence,
    endpointNodes: [],
    resourceNodes: [],
    configNodes: [],
    frameworkEdges: [],
    observations: [],
    limitations: [...(pack.limitations || [])].sort(),
  };
}
