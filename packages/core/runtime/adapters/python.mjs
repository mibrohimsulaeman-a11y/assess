import fs from "node:fs";
import {
  buildObservation,
  complexityFromLoc,
  containsEdge,
  createFileNode,
  createSymbolNode,
  extensionOf,
  importEdge,
  resolveRelative,
} from "./common.mjs";

const EXTENSIONS = ["py"];
const CODE_EXT = new Set(EXTENSIONS);

export const pythonAdapter = {
  id: "python-regex-v1",
  displayName: "Python adapter",
  languageIds: ["Python"],
  extensions: EXTENSIONS,
  parserStrategy: "indent-regex",
  limitations: [
    "Python adapter does not resolve dynamic imports or monkey-patched symbols",
    "Python adapter does not build a call graph",
  ],
  scanRepo: scanPythonRepo,
};

export function scanPythonRepo(context) {
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
    const extract = extractPythonFile(file.rel, content);
    fileExtracts.push(extract);
    const isTest = isPythonTestFile(file.rel);

    componentNodes.push(createFileNode({
      rel: file.rel,
      language: langOf(file.rel),
      lineCount: content.split(/\r?\n/).length,
      symbolCount: extract.symbols.length,
      isTest,
    }));

    for (const symbol of extract.symbols) {
      componentNodes.push(createSymbolNode(symbol, isTest));
      symbolById.set(symbol.id, symbol);
      factEdges.push(containsEdge(extract.fileId, symbol, file.rel));
      observations.push(buildObservation(symbol, isTest, sourceSha256, normalizedFingerprint));
    }
  }

  const fileSet = new Set(componentNodes.filter((node) => node.type === "file").map((node) => node.filePath));
  for (const extract of fileExtracts) {
    const fromDir = extract.fileId.replace(/^file:/, "").split("/").slice(0, -1).join("/") || ".";
    for (const imported of extract.imports) {
      if (!imported.startsWith(".")) continue;
      const resolved = resolveRelative(fromDir, imported, fileSet, pythonCandidatesForBase);
      if (resolved) factEdges.push(importEdge(extract.fileId, resolved, imported));
    }
  }

  return {
    adapterId: pythonAdapter.id,
    displayName: pythonAdapter.displayName,
    languageIds: pythonAdapter.languageIds,
    extensions: pythonAdapter.extensions,
    parserStrategy: pythonAdapter.parserStrategy,
    assessedFiles,
    indexedFileCount,
    componentNodes,
    factEdges,
    observations,
    fileExtracts,
    symbolById,
    limitations: pythonAdapter.limitations,
  };
}

function extractPythonFile(rel, content) {
  const lines = content.split(/\r?\n/);
  const symbols = [];
  const imports = new Set();
  const fileId = `file:${rel}`;
  const classStack = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const indent = leadingSpaces(line);
    while (classStack.length && indent <= classStack[classStack.length - 1].indent && trimmed) classStack.pop();

    const importRef = parsePythonImport(trimmed);
    if (importRef) imports.add(importRef);

    const classMatch = /^(?:class)\s+([A-Za-z_]\w*)\b/.exec(trimmed);
    if (classMatch) {
      const end = blockEndByIndent(lines, i, indent);
      const source = lines.slice(i, end + 1).join("\n");
      const loc = end - i + 1;
      const name = classMatch[1];
      symbols.push({
        id: `class:${rel}:${name}`,
        type: "class",
        name,
        filePath: rel,
        lineRange: [i + 1, end + 1],
        exported: !name.startsWith("_"),
        loc,
        complexity: complexityFromLoc(loc),
        source,
      });
      classStack.push({ name, indent });
      continue;
    }

    const fnMatch = /^(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/.exec(trimmed);
    if (fnMatch) {
      const end = blockEndByIndent(lines, i, indent);
      const source = lines.slice(i, end + 1).join("\n");
      const loc = end - i + 1;
      const rawName = fnMatch[1];
      const owner = classStack.length ? `${classStack[classStack.length - 1].name}.` : "";
      const name = `${owner}${rawName}`;
      symbols.push({
        id: `function:${rel}:${name}`,
        type: "function",
        name,
        filePath: rel,
        lineRange: [i + 1, end + 1],
        exported: !rawName.startsWith("_") && classStack.length === 0,
        loc,
        complexity: complexityFromLoc(loc),
        source,
      });
    }
  }

  return { fileId, imports: [...imports], routes: [], symbols };
}

function parsePythonImport(trimmed) {
  const fromMatch = /^from\s+([.A-Za-z_][\w.]*)\s+import\b/.exec(trimmed);
  if (fromMatch) return fromMatch[1].replace(/\.+$/, ".");
  const importMatch = /^import\s+([.A-Za-z_][\w.]*)/.exec(trimmed);
  return importMatch ? importMatch[1] : null;
}

function blockEndByIndent(lines, startIndex, baseIndent) {
  let end = startIndex;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) {
      end = i;
      continue;
    }
    if (leadingSpaces(lines[i]) <= baseIndent) return end;
    end = i;
  }
  return end;
}

function leadingSpaces(line) {
  return line.match(/^\s*/)?.[0].replace(/\t/g, "    ").length ?? 0;
}

function isPythonTestFile(rel) {
  return /(^|\/)(tests?|__tests__)\//.test(rel) || /(^|\/)test_[^/]+\.py$/.test(rel) || /_test\.py$/.test(rel);
}

function pythonCandidatesForBase(base) {
  const withoutDots = base.replace(/^\.\//, "");
  const modulePath = withoutDots.replace(/\./g, "/");
  return [
    base,
    `${base}.py`,
    `${base}/__init__.py`,
    modulePath,
    `${modulePath}.py`,
    `${modulePath}/__init__.py`,
  ];
}
