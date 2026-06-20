import fs from "node:fs";
import path from "node:path";

const EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
const CODE_EXT = new Set(EXTENSIONS);

export const javascriptTypeScriptAdapter = {
  id: "javascript-typescript-regex-v1",
  displayName: "JavaScript/TypeScript regex scanner",
  languageIds: ["JavaScript", "TypeScript"],
  extensions: EXTENSIONS,
  limitations: ["scanner cannot resolve dynamic/computed/re-exported symbols"],
  scanRepo: scanJavaScriptTypeScriptRepo,
};

export function scanJavaScriptTypeScriptRepo(context) {
  const { allFiles, langOf, sourceSha256, normalizedFingerprint } = context;
  const assessedFiles = allFiles.filter((file) => CODE_EXT.has(extensionOf(file.rel)));
  const componentNodes = [];
  const factEdges = [];
  const observations = [];
  const fileExtracts = [];
  const symbolById = new Map();
  let indexedFileCount = 0;

  for (const file of assessedFiles) {
    let content = "";
    try {
      content = fs.readFileSync(file.abs, "utf8");
    } catch {
      continue;
    }
    indexedFileCount++;
    const extract = extractFromFile(file.rel, content);
    fileExtracts.push(extract);
    const isTest = /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//.test(file.rel);

    componentNodes.push({
      id: extract.fileId,
      type: "file",
      name: file.rel.split("/").pop(),
      filePath: file.rel,
      summary: `${langOf(file.rel)} file, ${content.split(/\r?\n/).length} lines, ${extract.symbols.length} symbol(s)`,
      tags: isTest ? ["test"] : [],
      complexity: "simple",
    });

    for (const symbol of extract.symbols) {
      componentNodes.push({
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        filePath: symbol.filePath,
        lineRange: symbol.lineRange,
        summary: `${symbol.type} ${symbol.name} (${symbol.loc} lines${symbol.exported ? ", exported" : ""})`,
        tags: [symbol.exported ? "exported" : "internal", ...(isTest ? ["test"] : [])],
        complexity: symbol.complexity,
      });
      symbolById.set(symbol.id, symbol);
      factEdges.push({
        id: `edge:contains:${extract.fileId}->${symbol.id}`,
        source: extract.fileId,
        target: symbol.id,
        type: "contains",
        direction: "forward",
        weight: 0.8,
        evidence: { fact: `${file.rel}:${symbol.lineRange[0]} declares ${symbol.name}` },
      });

      const violations = isTest ? [] : baselineViolations(symbol);
      observations.push({
        nodeId: symbol.id,
        significance: symbol.exported && !isTest && symbol.loc >= 8 ? "high" : "low",
        evidenceFact: `${symbol.filePath}:${symbol.lineRange[0]}-${symbol.lineRange[1]} ${symbol.type} ${symbol.name}`,
        evidenceStrength: "verified",
        confidence: "HIGH",
        baselineViolations: violations,
        span: {
          filePath: symbol.filePath,
          lineRange: symbol.lineRange,
          spanSha256: sourceSha256(symbol.source),
          normalizedFingerprint: normalizedFingerprint(symbol.source),
        },
      });
    }
  }

  const fileSet = new Set(componentNodes.filter((node) => node.type === "file").map((node) => node.filePath));
  for (const extract of fileExtracts) {
    const fromDir = path.posix.dirname(extract.fileId.replace(/^file:/, ""));
    for (const imported of extract.imports) {
      if (!imported.startsWith(".")) continue;
      const resolved = resolveRelative(fromDir, imported, fileSet);
      if (!resolved) continue;
      factEdges.push({
        id: `edge:imports:${extract.fileId}->file:${resolved}`,
        source: extract.fileId,
        target: `file:${resolved}`,
        type: "imports",
        direction: "forward",
        weight: 0.8,
        evidence: { fact: `${extract.fileId.replace(/^file:/, "")} imports ${imported}` },
      });
    }
  }

  return {
    adapterId: javascriptTypeScriptAdapter.id,
    languageIds: javascriptTypeScriptAdapter.languageIds,
    assessedFiles,
    indexedFileCount,
    componentNodes,
    factEdges,
    observations,
    fileExtracts,
    symbolById,
    limitations: javascriptTypeScriptAdapter.limitations,
  };
}

function extensionOf(filePath) {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

function blockEndLine(lines, fromLine) {
  let depth = 0;
  let seen = false;
  for (let i = fromLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") {
        depth++;
        seen = true;
      } else if (ch === "}") {
        depth--;
      }
    }
    if (seen && depth <= 0) return i;
    if (i - fromLine > 4000) return i;
  }
  return lines.length - 1;
}

const RE = {
  cls: /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z0-9_$]+)/,
  fn: /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s+([A-Za-z0-9_$]+)/,
  arrow: /^\s*(?:export\s+)?(?:default\s+)?const\s+([A-Za-z0-9_$]+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*(?::[^=]+)?=>/,
  imp: /^\s*import\b[^"']*["']([^"']+)["']/,
  req: /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  route: /\b(?:app|router|server|fastify|api|r)\.(get|post|put|patch|delete|options|head|all|use)\s*\(\s*["'`]([^"'`]+)["'`]/g,
  exported: /^\s*export\b/,
};

function extractFromFile(rel, content) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const imports = new Set();
  const routes = [];
  const fileId = `file:${rel}`;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let match;
    if ((match = RE.imp.exec(line))) imports.add(match[1]);
    let requiredModule;
    RE.req.lastIndex = 0;
    while ((requiredModule = RE.req.exec(line))) imports.add(requiredModule[1]);
    RE.route.lastIndex = 0;
    let route;
    while ((route = RE.route.exec(line))) {
      routes.push({ method: route[1], path: route[2], line: i + 1 });
    }

    let name = null;
    let kind = null;
    if ((match = RE.cls.exec(line))) {
      name = match[1];
      kind = "class";
    } else if ((match = RE.fn.exec(line))) {
      name = match[1];
      kind = "function";
    } else if ((match = RE.arrow.exec(line))) {
      name = match[1];
      kind = "function";
    }
    if (!name) continue;

    const end = blockEndLine(lines, i);
    const span = lines.slice(i, end + 1).join("\n");
    const loc = end - i + 1;
    symbols.push({
      id: `${kind === "class" ? "class" : "function"}:${rel}:${name}`,
      type: kind,
      name,
      filePath: rel,
      lineRange: [i + 1, end + 1],
      exported: RE.exported.test(line),
      loc,
      complexity: loc > 120 ? "complex" : loc > 40 ? "moderate" : "simple",
      source: span,
    });
  }

  return { fileId, imports: [...imports], routes, symbols };
}

function baselineViolations(symbol) {
  const out = [];
  const body = symbol.source;
  if (/\beval\s*\(/.test(body)) {
    out.push({
      rule: "use of eval() on a code path",
      ruleSeverity: "P1",
      securitySensitive: true,
      fact: `${symbol.filePath}:${symbol.lineRange[0]}-${symbol.lineRange[1]} calls eval()`,
      category: "correctness",
    });
  }
  const todo = body.match(/\b(TODO|FIXME|XXX|HACK)\b/);
  if (todo) {
    out.push({
      rule: `unresolved ${todo[1]} marker in shipped code`,
      ruleSeverity: "P3",
      securitySensitive: false,
      fact: `${symbol.filePath}:${symbol.lineRange[0]}-${symbol.lineRange[1]} contains a ${todo[1]} comment`,
      category: "quality",
    });
  }
  if (symbol.loc > 120) {
    out.push({
      rule: "oversized function (low maintainability)",
      ruleSeverity: "P3",
      securitySensitive: false,
      fact: `${symbol.filePath}:${symbol.lineRange[0]}-${symbol.lineRange[1]} is ${symbol.loc} lines long`,
      category: "quality",
    });
  }
  return out;
}

function resolveRelative(fromDir, imported, fileSet) {
  const base = path.posix.normalize(path.posix.join(fromDir, imported));
  const candidates = [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + ".mjs",
    base + ".cjs",
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    path.posix.join(base, "index.ts"),
    path.posix.join(base, "index.js"),
    path.posix.join(base, "index.tsx"),
  ];
  for (const candidate of candidates) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}
