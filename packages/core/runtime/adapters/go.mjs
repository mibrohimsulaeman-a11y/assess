import fs from "node:fs";
import {
  buildObservation,
  complexityFromLoc,
  containsEdge,
  createFileNode,
  createSymbolNode,
  extensionOf,
} from "./common.mjs";

const EXTENSIONS = ["go"];
const CODE_EXT = new Set(EXTENSIONS);

export const goAdapter = {
  id: "go-regex-v1",
  displayName: "Go adapter",
  languageIds: ["Go"],
  extensions: EXTENSIONS,
  parserStrategy: "brace-regex",
  limitations: [
    "Go adapter does not resolve build tags or generated-code conventions",
    "Go adapter does not build a call graph",
  ],
  scanRepo: scanGoRepo,
};

export function scanGoRepo(context) {
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
    const extract = extractGoFile(file.rel, content);
    fileExtracts.push(extract);
    const isTest = /_test\.go$/.test(file.rel);

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

  return {
    adapterId: goAdapter.id,
    displayName: goAdapter.displayName,
    languageIds: goAdapter.languageIds,
    extensions: goAdapter.extensions,
    parserStrategy: goAdapter.parserStrategy,
    assessedFiles,
    indexedFileCount,
    componentNodes,
    factEdges,
    observations,
    fileExtracts,
    symbolById,
    limitations: goAdapter.limitations,
  };
}

function extractGoFile(rel, content) {
  const lines = content.split(/\r?\n/);
  const imports = parseGoImports(lines);
  const symbols = [];
  const fileId = `file:${rel}`;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fnMatch = /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/.exec(line);
    if (!fnMatch) continue;
    const end = blockEndLine(lines, i);
    const source = lines.slice(i, end + 1).join("\n");
    const loc = end - i + 1;
    const name = fnMatch[1];
    symbols.push({
      id: `function:${rel}:${name}`,
      type: "function",
      name,
      filePath: rel,
      lineRange: [i + 1, end + 1],
      exported: /^[A-Z]/.test(name),
      loc,
      complexity: complexityFromLoc(loc),
      source,
    });
  }

  return { fileId, imports, routes: [], symbols };
}

function parseGoImports(lines) {
  const imports = [];
  let inBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("import (") || trimmed === "import(") {
      inBlock = true;
      continue;
    }
    if (inBlock && trimmed === ")") {
      inBlock = false;
      continue;
    }
    const single = /^import\s+(?:[A-Za-z_][\w.]*\s+)?"([^"]+)"/.exec(trimmed);
    if (single) imports.push(single[1]);
    if (inBlock) {
      const block = /^(?:[A-Za-z_][\w.]*\s+)?"([^"]+)"/.exec(trimmed);
      if (block) imports.push(block[1]);
    }
  }
  return imports;
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
