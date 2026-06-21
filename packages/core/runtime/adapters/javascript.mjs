import fs from "node:fs";
import { createRequire } from "node:module";
import {
  buildObservation,
  complexityFromLoc,
  containsEdge,
  createFileNode,
  createSymbolNode,
  extensionOf,
  importEdge,
  isGenericTestFile,
  resolveRelative,
} from "./common.mjs";

const require = createRequire(import.meta.url);
const EXTENSIONS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"];
const CODE_EXT = new Set(EXTENSIONS);
const ts = loadTypeScript();

export const javascriptTypeScriptAdapter = {
  id: "javascript-typescript-v2",
  displayName: "JavaScript/TypeScript adapter",
  languageIds: ["JavaScript", "TypeScript"],
  extensions: EXTENSIONS,
  parserStrategy: ts ? "typescript-compiler-api" : "regex-brace-fallback",
  limitations: ts
    ? ["TypeScript compiler parser does not resolve dynamic/computed/re-exported symbols"]
    : ["scanner cannot resolve dynamic/computed/re-exported symbols"],
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
    const isTest = isGenericTestFile(file.rel);

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
      const resolved = resolveRelative(fromDir, imported, fileSet, jsCandidatesForBase);
      if (resolved) factEdges.push(importEdge(extract.fileId, resolved, imported));
    }
  }

  return {
    adapterId: javascriptTypeScriptAdapter.id,
    displayName: javascriptTypeScriptAdapter.displayName,
    languageIds: javascriptTypeScriptAdapter.languageIds,
    extensions: javascriptTypeScriptAdapter.extensions,
    parserStrategy: javascriptTypeScriptAdapter.parserStrategy,
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

function loadTypeScript() {
  try {
    return require("typescript");
  } catch {
    return null;
  }
}

function extractFromFile(rel, content) {
  if (ts) {
    try {
      return extractWithTypeScript(rel, content);
    } catch {
      return extractWithRegex(rel, content);
    }
  }
  return extractWithRegex(rel, content);
}

function extractWithTypeScript(rel, content) {
  const sourceFile = ts.createSourceFile(rel, content, ts.ScriptTarget.Latest, true, scriptKindFor(rel));
  const imports = new Set();
  const routes = [];
  const symbols = [];
  const fileId = `file:${rel}`;

  function addSymbol(node, kind, name, exported = false) {
    if (!name) return;
    const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;
    const end = sourceFile.getLineAndCharacterOfPosition(node.end).line + 1;
    const source = content.slice(node.getStart(sourceFile), node.end);
    const loc = Math.max(1, end - start + 1);
    symbols.push({
      id: `${kind === "class" ? "class" : "function"}:${rel}:${name}`,
      type: kind,
      name,
      filePath: rel,
      lineRange: [start, end],
      exported,
      loc,
      complexity: complexityFromLoc(loc),
      source,
    });
  }

  function exported(node) {
    return Boolean(ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export);
  }

  function visit(node, className = null) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.add(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const call = callInfo(node);
      if (call?.imported) imports.add(call.imported);
      if (call?.route) routes.push(call.route);
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      addSymbol(node, "function", node.name.text, exported(node));
    } else if (ts.isClassDeclaration(node) && node.name) {
      addSymbol(node, "class", node.name.text, exported(node));
      for (const member of node.members || []) visit(member, node.name.text);
      return;
    } else if (ts.isMethodDeclaration(node) && className && node.name) {
      const methodName = propertyNameText(node.name);
      if (methodName) addSymbol(node, "function", `${className}.${methodName}`, false);
    } else if (ts.isVariableStatement(node)) {
      const isExported = exported(node);
      for (const declaration of node.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        if (declaration.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
          addSymbol(declaration, "function", declaration.name.text, isExported);
        }
      }
    }
    ts.forEachChild(node, (child) => visit(child, className));
  }

  visit(sourceFile);
  return { fileId, imports: [...imports], routes, symbols: dedupeSymbols(symbols) };
}

function callInfo(node) {
  if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
    const arg = node.arguments?.[0];
    return ts.isStringLiteral(arg) ? { imported: arg.text } : null;
  }
  if (!ts.isPropertyAccessExpression(node.expression)) return null;
  const method = node.expression.name.text;
  const receiver = node.expression.expression.getText();
  const httpMethods = new Set(["get", "post", "put", "patch", "delete", "options", "head", "all", "use"]);
  const receivers = new Set(["app", "router", "server", "fastify", "api", "r"]);
  if (!httpMethods.has(method) || !receivers.has(receiver)) return null;
  const first = node.arguments?.[0];
  if (!ts.isStringLiteral(first) && !ts.isNoSubstitutionTemplateLiteral(first)) return null;
  const line = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()).line + 1;
  return { route: { method, path: first.text, line } };
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function scriptKindFor(rel) {
  const ext = extensionOf(rel);
  if (ext === "tsx") return ts.ScriptKind.TSX;
  if (ext === "jsx") return ts.ScriptKind.JSX;
  if (["ts", "mts", "cts"].includes(ext)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

function dedupeSymbols(symbols) {
  const seen = new Set();
  const out = [];
  for (const symbol of symbols) {
    if (seen.has(symbol.id)) continue;
    seen.add(symbol.id);
    out.push(symbol);
  }
  return out;
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

function extractWithRegex(rel, content) {
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
    while ((route = RE.route.exec(line))) routes.push({ method: route[1], path: route[2], line: i + 1 });

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
    const source = lines.slice(i, end + 1).join("\n");
    const loc = end - i + 1;
    symbols.push({
      id: `${kind === "class" ? "class" : "function"}:${rel}:${name}`,
      type: kind,
      name,
      filePath: rel,
      lineRange: [i + 1, end + 1],
      exported: RE.exported.test(line),
      loc,
      complexity: complexityFromLoc(loc),
      source,
    });
  }
  return { fileId, imports: [...imports], routes, symbols };
}

function jsCandidatesForBase(base) {
  return [
    base,
    base + ".ts",
    base + ".tsx",
    base + ".js",
    base + ".jsx",
    base + ".mjs",
    base + ".cjs",
    base.replace(/\.js$/, ".ts"),
    base.replace(/\.js$/, ".tsx"),
    `${base}/index.ts`,
    `${base}/index.js`,
    `${base}/index.tsx`,
  ];
}
