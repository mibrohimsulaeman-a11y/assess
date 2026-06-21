import path from "node:path";

export function extensionOf(filePath) {
  return filePath.split(".").pop()?.toLowerCase() ?? "";
}

export function complexityFromLoc(loc) {
  return loc > 120 ? "complex" : loc > 40 ? "moderate" : "simple";
}

export function isGenericTestFile(filePath) {
  return /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//.test(filePath);
}

export function createFileNode({ rel, language, lineCount, symbolCount, isTest = false }) {
  return {
    id: `file:${rel}`,
    type: "file",
    name: rel.split("/").pop(),
    filePath: rel,
    summary: `${language} file, ${lineCount} lines, ${symbolCount} symbol(s)`,
    tags: isTest ? ["test"] : [],
    complexity: "simple",
  };
}

export function createSymbolNode(symbol, isTest = false) {
  return {
    id: symbol.id,
    type: symbol.type,
    name: symbol.name,
    filePath: symbol.filePath,
    lineRange: symbol.lineRange,
    summary: `${symbol.type} ${symbol.name} (${symbol.loc} lines${symbol.exported ? ", exported" : ""})`,
    tags: [symbol.exported ? "exported" : "internal", ...(isTest ? ["test"] : [])],
    complexity: symbol.complexity,
  };
}

export function containsEdge(fileId, symbol, factPrefix) {
  return {
    id: `edge:contains:${fileId}->${symbol.id}`,
    source: fileId,
    target: symbol.id,
    type: "contains",
    direction: "forward",
    weight: 0.8,
    evidence: { fact: `${factPrefix}:${symbol.lineRange[0]} declares ${symbol.name}` },
  };
}

export function buildObservation(symbol, isTest, sourceSha256, normalizedFingerprint) {
  return {
    nodeId: symbol.id,
    significance: symbol.exported && !isTest && symbol.loc >= 8 ? "high" : "low",
    evidenceFact: `${symbol.filePath}:${symbol.lineRange[0]}-${symbol.lineRange[1]} ${symbol.type} ${symbol.name}`,
    evidenceStrength: "verified",
    confidence: "HIGH",
    baselineViolations: isTest ? [] : baselineViolations(symbol),
    span: {
      filePath: symbol.filePath,
      lineRange: symbol.lineRange,
      spanSha256: sourceSha256(symbol.source),
      normalizedFingerprint: normalizedFingerprint(symbol.source),
    },
  };
}

export function baselineViolations(symbol) {
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
  if (/\bpanic\s*\(/.test(body)) {
    out.push({
      rule: "panic() reachable inside indexed code",
      ruleSeverity: "P2",
      securitySensitive: false,
      fact: `${symbol.filePath}:${symbol.lineRange[0]}-${symbol.lineRange[1]} calls panic()`,
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

export function importEdge(fileId, resolved, imported) {
  return {
    id: `edge:imports:${fileId}->file:${resolved}`,
    source: fileId,
    target: `file:${resolved}`,
    type: "imports",
    direction: "forward",
    weight: 0.8,
    evidence: { fact: `${fileId.replace(/^file:/, "")} imports ${imported}` },
  };
}

export function resolveRelative(fromDir, imported, fileSet, candidatesForBase) {
  const base = path.posix.normalize(path.posix.join(fromDir, imported));
  for (const candidate of candidatesForBase(base)) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}
