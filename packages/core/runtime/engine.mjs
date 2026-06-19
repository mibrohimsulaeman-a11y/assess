// =====================================================================
// assess — headless assessment engine (zero-dependency executable boundary)
//
// This is the deterministic runtime the plugin / MCP server / CLI shim all call.
// It mirrors the typed reference in packages/core/src/** but imports nothing, so
// it runs with plain `node` before anything is installed (same discipline as
// scripts/validate-graph.cjs). It is what makes a finding evidence-bound rather
// than a free-form model comment:
//
//   read repo -> build deterministic index -> bind to (optional) confirmed
//   intent -> run the three gap directions -> assemble assessment-graph.json
//   -> structurally + honesty validate -> write .assessment/assessment-graph.json
//
// It NEVER edits your code. Every finding carries a deterministic fact or a
// bounded missing-code proof; severity is capped by evidence strength.
// =====================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

// The structural + honesty validator is the SAME zero-dep module CI and the MCP
// server use. Loading it here means assessRepo can never return or write a graph
// that the published contract would reject.
const require = createRequire(import.meta.url);
const ENGINE_DIR = path.dirname(fileURLToPath(import.meta.url));
const VALIDATOR_PATH = path.join(ENGINE_DIR, "..", "scripts", "validate-graph.cjs");

// ---------- constants ----------

const DEFAULT_EXCLUDES = [
  /(^|\/)node_modules\//, /(^|\/)\.git\//, /(^|\/)dist\//, /(^|\/)build\//,
  /(^|\/)\.next\//, /(^|\/)vendor\//, /(^|\/)coverage\//, /(^|\/)\.assessment\//,
  /\.min\.(js|css)$/, /-lock\.(json|yaml)$/, /\.lock$/,
  /\.(png|jpe?g|gif|svg|ico|webp|woff2?|ttf|eot|mp4|zip|pdf)$/,
];

const EXT_LANG = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", java: "Java", rb: "Ruby", php: "PHP",
  sql: "SQL", yaml: "YAML", yml: "YAML", json: "JSON", md: "Markdown",
};

const CODE_EXT = new Set(["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]);
const SEVERITY_ORDER = ["P3", "P2", "P1", "P0"];
const STRENGTH_RANK = { verified: 2, inferred: 1, unverifiable: 0 };

// ---------- small utils ----------

function sha256(s) {
  return "sha256:" + crypto.createHash("sha256").update(s, "utf8").digest("hex");
}
function normalizeSource(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/#[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .replace(/,\s*([)\]}])/g, "$1")
    .trim();
}
function normalizedFingerprint(src) {
  return "nfp:" + crypto.createHash("sha256").update(normalizeSource(src), "utf8").digest("hex");
}
function kebab(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
function langOf(p) {
  return EXT_LANG[p.split(".").pop()?.toLowerCase() ?? ""] ?? "Other";
}
function isExcluded(rel) {
  for (const re of DEFAULT_EXCLUDES) if (re.test(rel)) return true;
  return false;
}
function maxSeverity(a, b) {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}
function worstSeverity(list) {
  if (!list.length) return null;
  return list.reduce((acc, s) => maxSeverity(acc, s));
}
function capTo(sev, max) {
  return SEVERITY_ORDER.indexOf(sev) <= SEVERITY_ORDER.indexOf(max) ? sev : max;
}

// ---------- severity engine (mirror of src/assess/severity.ts) ----------

function resolveSeverity(input) {
  let severity = input.ruleSeverity;
  const applied = [];
  if (input.evidenceStrength === "unverifiable") {
    const n = capTo(severity, "P2"); if (n !== severity) applied.push("unverifiable evidence -> <=P2"); severity = n;
  } else if (input.evidenceStrength === "inferred" && !input.secondVerifiedFact) {
    const n = capTo(severity, "P1"); if (n !== severity) applied.push("inferred evidence, no 2nd verified fact -> <=P1"); severity = n;
  }
  if (input.confidence === "LOW") {
    const n = capTo(severity, "P3"); if (n !== severity) applied.push("LOW confidence -> <=P3"); severity = n;
  }
  if (input.intentUnconfirmed) {
    const n = capTo(severity, "P2"); if (n !== severity) applied.push("UNCONFIRMED intent -> <=P2"); severity = n;
  }
  if (input.missingCodeResult && input.missingCodeResult !== "absent") {
    const n = capTo(severity, "P2"); if (n !== severity) applied.push(`absence ${input.missingCodeResult} -> <=P2`); severity = n;
  }
  if (input.securitySensitive) {
    const f = maxSeverity(severity, "P1"); if (f !== severity) applied.push("security-sensitive path -> floor P1"); severity = f;
  }
  return { severity, applied };
}

function computeMissingCodeProof(input) {
  const required = input.coverageRequired ?? 1.0;
  const residues = input.lowConfidenceResidues ?? [];
  const ruled = new Set(input.residuesRuledIrrelevant ?? []);
  const unresolved = residues.filter((r) => !ruled.has(r));
  let result;
  if (input.coverageActual >= required && unresolved.length === 0) result = "absent";
  else if (input.coverageActual >= 0.5) result = "not_found_in_index";
  else result = "coverage_insufficient";
  return {
    result,
    searchedRoots: input.searchedRoots,
    excludedRoots: input.excludedRoots,
    requiredRecordTypes: input.requiredRecordTypes,
    coverage: { required, actual: input.coverageActual },
    lowConfidenceResidues: unresolved,
    residuesRuledIrrelevant: input.residuesRuledIrrelevant ?? [],
  };
}

function headlineTrust(findings) {
  let weakest = "verified";
  for (const f of findings) {
    if (STRENGTH_RANK[f.evidence.strength] < STRENGTH_RANK[weakest]) weakest = f.evidence.strength;
  }
  return weakest;
}

// ---------- SCAN: enumerate every file, partition into areas ----------

function walk(root) {
  const out = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of entries) {
      const abs = path.join(dir, ent.name);
      const rel = path.relative(root, abs).split(path.sep).join("/");
      if (isExcluded(rel + (ent.isDirectory() ? "/" : ""))) continue;
      if (ent.isDirectory()) stack.push(abs);
      else if (ent.isFile()) {
        let bytes = 0;
        try { bytes = fs.statSync(abs).size; } catch {}
        out.push({ abs, rel, bytes });
      }
    }
  }
  return out.sort((a, b) => a.rel.localeCompare(b.rel));
}

function areaOf(rel) {
  const top = rel.includes("/") ? rel.split("/")[0] : "(root)";
  return { id: `area:${kebab(top) || "root"}`, name: top };
}

// ---------- INDEX: deterministic TS/JS symbol + relation extraction ----------

// Find the end line of a brace-delimited block starting at/after `fromLine`.
function blockEndLine(lines, fromLine) {
  let depth = 0, seen = false;
  for (let i = fromLine; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; seen = true; }
      else if (ch === "}") { depth--; }
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
    let m;
    if ((m = RE.imp.exec(line))) imports.add(m[1]);
    let rm;
    RE.req.lastIndex = 0;
    while ((rm = RE.req.exec(line))) imports.add(rm[1]);
    RE.route.lastIndex = 0;
    let rt;
    while ((rt = RE.route.exec(line))) routes.push({ method: rt[1], path: rt[2], line: i + 1 });

    let name = null, kind = null;
    if ((m = RE.cls.exec(line))) { name = m[1]; kind = "class"; }
    else if ((m = RE.fn.exec(line))) { name = m[1]; kind = "function"; }
    else if ((m = RE.arrow.exec(line))) { name = m[1]; kind = "function"; }
    if (name) {
      const end = blockEndLine(lines, i);
      const span = lines.slice(i, end + 1).join("\n");
      const len = end - i + 1;
      symbols.push({
        id: `${kind === "class" ? "class" : "function"}:${rel}:${name}`,
        type: kind,
        name,
        filePath: rel,
        lineRange: [i + 1, end + 1],
        exported: RE.exported.test(line),
        loc: len,
        complexity: len > 120 ? "complex" : len > 40 ? "moderate" : "simple",
        source: span,
      });
    }
  }
  return { fileId, imports: [...imports], routes, symbols };
}

// Conservative, deterministic baseline checks. Each returns a VERIFIED fact
// (the token/line-count literally exists), so the claim never over-reaches.
function baselineViolations(sym) {
  const out = [];
  const body = sym.source;
  if (/\beval\s*\(/.test(body)) {
    out.push({ rule: "use of eval() on a code path", ruleSeverity: "P1", securitySensitive: true,
      fact: `${sym.filePath}:${sym.lineRange[0]}-${sym.lineRange[1]} calls eval()`, category: "correctness" });
  }
  const todo = body.match(/\b(TODO|FIXME|XXX|HACK)\b/);
  if (todo) {
    out.push({ rule: `unresolved ${todo[1]} marker in shipped code`, ruleSeverity: "P3", securitySensitive: false,
      fact: `${sym.filePath}:${sym.lineRange[0]}-${sym.lineRange[1]} contains a ${todo[1]} comment`, category: "quality" });
  }
  if (sym.loc > 120) {
    out.push({ rule: "oversized function (low maintainability)", ruleSeverity: "P3", securitySensitive: false,
      fact: `${sym.filePath}:${sym.lineRange[0]}-${sym.lineRange[1]} is ${sym.loc} lines long`, category: "quality" });
  }
  return out;
}

// ---------- intent spec loading (optional) ----------

function loadIntentSpec(intentSpecPath) {
  if (!intentSpecPath) return null;
  if (!fs.existsSync(intentSpecPath)) throw new Error(`intent spec not found: ${intentSpecPath}`);
  const raw = fs.readFileSync(intentSpecPath, "utf8");
  const spec = JSON.parse(raw);
  if (!spec.capabilities) throw new Error("intent spec must have a 'capabilities' array");
  return spec;
}

function hashIntentSpec(spec) {
  if (!spec) return "ispec:none";
  const confirmed = {
    project: spec.project ?? "",
    capabilities: (spec.capabilities || [])
      .filter((c) => c.status === "CONFIRMED")
      .map((c) => ({
        id: c.id,
        owns: [...(c.ownsComponentIds || [])].sort(),
        processes: (c.processes || [])
          .map((p) => ({ id: p.id, invariant: p.invariant, critical: !!p.criticalPath }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return "ispec:" + crypto.createHash("sha256").update(JSON.stringify(confirmed), "utf8").digest("hex");
}

function intentNodes(spec) {
  if (!spec) return [];
  const nodes = [];
  for (const cap of spec.capabilities || []) {
    nodes.push({
      id: cap.id, type: "capability", name: cap.label || cap.id,
      summary: cap.description || "", tags: ["intent"], complexity: "simple",
      intentMeta: { status: cap.status, owns: cap.ownsComponentIds || [] },
    });
    for (const p of cap.processes || []) {
      nodes.push({
        id: p.id, type: "intent", name: p.label || p.id,
        summary: p.invariant || "", tags: ["intent", p.criticalPath ? "critical-path" : "normal"],
        complexity: "simple",
        intentMeta: { status: cap.status, invariant: p.invariant, criticalPath: !!p.criticalPath },
      });
    }
  }
  return nodes;
}

// ---------- main entry ----------

/**
 * @param  repoRoot: string, intentSpecPath?: string|null, outDir?: string, commit?: string  opts
 * @returns  graph: object, outPath: string|null, summary: object 
 */
export function assessRepo(opts) {
  const repoRoot = path.resolve(opts.repoRoot);
  const generated = new Date().toISOString();
  const commit = opts.commit ?? gitCommit(repoRoot);
  const spec = loadIntentSpec(opts.intentSpecPath);
  const intentSpecHash = hashIntentSpec(spec);
  const binding = { assessedAtCommit: commit, intentSpecHash, generated };
  const hasIntent = !!spec && (spec.capabilities || []).some((c) => c.status === "CONFIRMED");

  // SCAN
  const allFiles = walk(repoRoot);
  const assessedFiles = allFiles.filter((f) => !isExcluded(f.rel) && CODE_EXT.has(f.rel.split(".").pop()?.toLowerCase()));
  const languages = [...new Set(allFiles.map((f) => langOf(f.rel)).filter((l) => l !== "Other"))];

  // INDEX
  const componentNodes = [];
  const factEdges = [];
  const observations = [];
  const fileExtracts = [];
  const symbolById = new Map();
  // Measured index coverage: fraction of enumerated code files we actually read
  // and parsed into the index. Drives the missing-code proof instead of a guess.
  let indexedFileCount = 0;

  for (const f of assessedFiles) {
    let content = "";
    try { content = fs.readFileSync(f.abs, "utf8"); } catch { continue; }
    indexedFileCount++;
    const ex = extractFromFile(f.rel, content);
    fileExtracts.push(ex);
    const isTest = /(\.|\/)(test|spec)\.|(^|\/)(tests?|__tests__)\//.test(f.rel);

    componentNodes.push({
      id: ex.fileId, type: "file", name: f.rel.split("/").pop(), filePath: f.rel,
      summary: `${langOf(f.rel)} file, ${content.split(/\r?\n/).length} lines, ${ex.symbols.length} symbol(s)`,
      tags: isTest ? ["test"] : [], complexity: "simple",
    });

    for (const s of ex.symbols) {
      const node = {
        id: s.id, type: s.type, name: s.name, filePath: s.filePath, lineRange: s.lineRange,
        summary: `${s.type} ${s.name} (${s.loc} lines${s.exported ? ", exported" : ""})`,
        tags: [s.exported ? "exported" : "internal", ...(isTest ? ["test"] : [])],
        complexity: s.complexity,
      };
      componentNodes.push(node);
      symbolById.set(s.id, s);
      factEdges.push({
        id: `edge:contains:${ex.fileId}->${s.id}`, source: ex.fileId, target: s.id,
        type: "contains", direction: "forward", weight: 0.8,
        evidence: { fact: `${f.rel}:${s.lineRange[0]} declares ${s.name}` },
      });

      const violations = isTest ? [] : baselineViolations(s);
      observations.push({
        nodeId: s.id,
        significance: s.exported && !isTest && s.loc >= 8 ? "high" : "low",
        evidenceFact: `${s.filePath}:${s.lineRange[0]}-${s.lineRange[1]} ${s.type} ${s.name}`,
        evidenceStrength: "verified", // existence of the symbol is byte-verifiable
        confidence: "HIGH",
        baselineViolations: violations,
        span: { filePath: s.filePath, lineRange: s.lineRange, spanSha256: sha256(s.source), normalizedFingerprint: normalizedFingerprint(s.source) },
      });
    }
  }

  // import edges (file -> file) for resolvable relative imports
  const fileSet = new Set(componentNodes.filter((n) => n.type === "file").map((n) => n.filePath));
  for (const ex of fileExtracts) {
    const fromDir = path.posix.dirname(ex.fileId.replace(/^file:/, ""));
    for (const imp of ex.imports) {
      if (!imp.startsWith(".")) continue; // skip packages; only intra-repo edges are facts here
      const resolved = resolveRelative(fromDir, imp, fileSet);
      if (resolved) {
        factEdges.push({
          id: `edge:imports:${ex.fileId}->file:${resolved}`,
          source: ex.fileId, target: `file:${resolved}`,
          type: "imports", direction: "forward", weight: 0.8,
          evidence: { fact: `${ex.fileId.replace(/^file:/, "")} imports ${imp}` },
        });
      }
    }
  }

  // ENGINE: gap directions
  const findings = [];
  const gapEdges = [];
  let seq = { A: 0, C: 0, Q: 0 };
  const nextId = (p) => `${p}-${String((seq[p] += 1)).padStart(3, "0")}`;
  const notAssessed = new Map();
  // expected-but-absent components get an explicit placeholder node so the gap
  // is visible AND every edge/finding endpoint resolves (referential integrity).
  const absentNodes = new Map();

  // Direction 3 — baseline -> code (always runs; intent-independent)
  for (const obs of observations) {
    for (const v of obs.baselineViolations) {
      const dec = resolveSeverity({ ruleSeverity: v.ruleSeverity, evidenceStrength: "verified", confidence: "HIGH", securitySensitive: v.securitySensitive });
      const id = nextId(v.category === "quality" ? "Q" : "C");
      findings.push({
        id, direction: "baseline_to_code", category: v.category, claim: v.rule,
        evidence: { fact: v.fact, strength: "verified", filePath: obs.span.filePath, lineRange: obs.span.lineRange },
        severity: dec.severity, confidence: "HIGH",
        explanation: dec.applied.length ? dec.applied.join("; ") : "Deterministic baseline rule violation.",
        recommendation: "Fix to restore the engineering baseline.",
        targetNodeIds: [obs.nodeId],
        binding: { ...binding, spanSha256: obs.span.spanSha256, normalizedFingerprint: obs.span.normalizedFingerprint },
      });
      // ID must include the finding id: a single node can have several baseline
      // violations, and keying only on the target would collide (duplicate edge
      // ids -> the renderer silently drops edges, and integrity is violated).
      gapEdges.push({ id: `gap:baseline_to_code:${id}:baseline->${obs.nodeId}`, source: "baseline", target: obs.nodeId, type: "baseline_to_code", direction: "forward", weight: 0.9, gap: { direction: "baseline_to_code", status: "violation", findingId: id }, evidence: { fact: v.rule } });
    }
  }

  // Directions 1 & 2 only run with confirmed intent (otherwise honestly skipped)
  const obsByNode = new Map(observations.map((o) => [o.nodeId, o]));
  // Real coverage of the symbol index: how much of the enumerated code we parsed.
  // 0 when there is nothing to index, so an absence claim stays "coverage_insufficient".
  const indexCoverage = assessedFiles.length ? indexedFileCount / assessedFiles.length : 0;
  const capabilityOwns = new Set();
  if (hasIntent) {
    const ownsByNode = new Map();
    for (const cap of spec.capabilities) {
      if (cap.status !== "CONFIRMED") continue;
      for (const cid of cap.ownsComponentIds || []) {
        ownsByNode.set(cid, cap.id);
        capabilityOwns.add(cid);
      }
    }

    // 1: intent -> code
    for (const cap of spec.capabilities) {
      for (const p of cap.processes || []) {
        for (const compId of p.expectedComponentIds || []) {
          const present = symbolById.has(compId) || fileSet.has(compId.replace(/^file:/, ""));
          let status, category = null, ruleSeverity = "P2", proof;
          if (!present) {
            status = "missing"; category = "alignment.missing"; ruleSeverity = p.criticalPath ? "P0" : "P1";
            proof = computeMissingCodeProof({
              searchedRoots: [path.relative(repoRoot, repoRoot) || "."], excludedRoots: ["node_modules", "dist", "build"],
              requiredRecordTypes: ["symbol"],
              // MEASURED, not assumed: the fraction of enumerated code files we could
              // actually parse into the symbol index. This is a real coverage figure.
              coverageActual: indexCoverage,
              // A regex/brace scanner can never prove TRUE absence: dynamic dispatch,
              // re-exports, and computed names are invisible to it. This standing
              // residue keeps every absence proof at most "not_found_in_index", which
              // the severity engine caps at <=P2 — so a scanner limitation can never
              // masquerade as a P0/P1 "proven absent" finding.
              lowConfidenceResidues: ["scanner cannot resolve dynamic/computed/re-exported symbols"],
            });
          } else { status = "satisfied"; }
          let findingId;
          if (category) {
            const dec = resolveSeverity({ ruleSeverity, evidenceStrength: "inferred", confidence: "MED", securitySensitive: p.securitySensitive, missingCodeResult: proof?.result });
            findingId = nextId("A");
            findings.push({
              id: findingId, direction: "intent_to_code", category,
              claim: `Promised "${p.label || p.id}" has no implementing path found in the index`,
              evidence: { fact: `expected component ${compId} not present in index`, strength: "inferred", signals: p.invariant ? [`invariant: ${p.invariant}`] : undefined },
              intentRef: p.id, severity: dec.severity, confidence: "MED",
              explanation: dec.applied.length ? dec.applied.join("; ") : "Severity from rubric.",
              recommendation: "Implement the promised behavior or retract the claim from intent.",
              missingCodeProof: proof, targetNodeIds: [compId, p.id], binding: { ...binding },
            });
            if (!present && !absentNodes.has(compId)) {
              absentNodes.set(compId, {
                id: compId, type: "concept", name: compId.split(":").pop() || compId,
                summary: "Expected by confirmed intent, not found in the index",
                tags: ["expected-absent"], complexity: "simple",
                assessment: {
                  coverageStatus: "not_assessed", ownership: deriveOwnership(compId, factEdges, capabilityOwns), findingIds: [findingId],
                  readiness: "blocked", worstSeverity: dec.severity, trust: "inferred",
                  notAssessedReason: "expected by confirmed intent but no implementing path found in the index",
                },
              });
            }
          }
          gapEdges.push({ id: `gap:intent_to_code:${p.id}->${compId}`, source: p.id, target: compId, type: "intent_to_code", direction: "forward", weight: status === "satisfied" ? 0.3 : 0.9, gap: { direction: "intent_to_code", status, findingId }, evidence: { fact: status === "satisfied" ? "implementing path present in index" : (findingId || "") } });
        }
      }
    }
    // 2: code -> intent (unexplained significant components)
    for (const obs of observations) {
      const mapped = ownsByNode.get(obs.nodeId);
      if (mapped) { gapEdges.push({ id: `gap:code_to_intent:${obs.nodeId}->${mapped}`, source: obs.nodeId, target: mapped, type: "code_to_intent", direction: "forward", weight: 0.3, gap: { direction: "code_to_intent", status: "justified", findingId: undefined }, evidence: { fact: "maps to confirmed capability" } }); continue; }
      if (obs.significance !== "high") continue;
      const proof = computeMissingCodeProof({
        searchedRoots: [path.relative(repoRoot, repoRoot) || "."],
        excludedRoots: ["node_modules", "dist", "build"],
        requiredRecordTypes: ["symbol"],
        coverageActual: indexCoverage,
        lowConfidenceResidues: ["intent spec may be incomplete or owner intent may be unconfirmed"],
      });
      const dec = resolveSeverity({ ruleSeverity: "P2", evidenceStrength: "verified", confidence: "MED", intentUnconfirmed: true });
      const id = nextId("A");
      findings.push({
        id, direction: "code_to_intent", category: "alignment.unexplained",
        claim: "Significant exported component has no confirmed intent mapping in the supplied intent spec",
        evidence: { fact: obs.evidenceFact, strength: "verified", filePath: obs.span.filePath, lineRange: obs.span.lineRange },
        intentRef: "UNCONFIRMED", severity: dec.severity, confidence: "MED",
        explanation: "Code existence is byte-verified; absence of a confirmed intent mapping is bounded by the supplied intent spec and index coverage.",
        recommendation: "Confirm whether this is intended; document it in the intent spec or remove it.",
        missingCodeProof: proof, targetNodeIds: [obs.nodeId], binding: { ...binding },
      });
      gapEdges.push({ id: `gap:code_to_intent:${obs.nodeId}->intent:UNCONFIRMED`, source: obs.nodeId, target: "intent:UNCONFIRMED", type: "code_to_intent", direction: "forward", weight: 0.9, gap: { direction: "code_to_intent", status: "unexplained", findingId: id }, evidence: { fact: "no confirmed intent" } });
    }
  } else {
    // No confirmed intent: be honest — intent_to_code & code_to_intent are NOT
    // evaluable. Mark every assessable node partial with an explicit reason.
    for (const n of componentNodes) {
      notAssessed.set(n.id, "no confirmed intent supplied: only the engineering baseline was assessed; intent_to_code and code_to_intent were not evaluated");
    }
  }

  // ASSEMBLE
  const findingsByNode = new Map();
  for (const f of findings) for (const nid of f.targetNodeIds) {
    if (!findingsByNode.has(nid)) findingsByNode.set(nid, []);
    findingsByNode.get(nid).push(f);
  }

  const stampedNodes = componentNodes.map((node) => {
    const nf = findingsByNode.get(node.id) ?? [];
    const worst = worstSeverity(nf.map((f) => f.severity));
    const reason = notAssessed.get(node.id);
    let coverageStatus = "assessed";
    if (reason) coverageStatus = "partial"; // baseline-only => partial, not fully assessed
    const trust = nf.reduce((acc, f) => (acc && STRENGTH_RANK[acc] <= STRENGTH_RANK[f.evidence.strength] ? acc : f.evidence.strength), undefined);
    return {
      ...node,
      assessment: {
        coverageStatus,
        ownership: deriveOwnership(node.id, factEdges, capabilityOwns),
        findingIds: nf.map((f) => f.id),
        readiness: reason ? "partial" : worst === "P0" ? "blocked" : worst === "P1" ? "partial" : worst ? "partial" : "ready",
        worstSeverity: worst,
        trust,
        notAssessedReason: reason,
      },
    };
  });
  // append explicit placeholders for expected-but-absent components
  for (const an of absentNodes.values()) stampedNodes.push(an);

  const iNodes = intentNodes(spec);
  const nodeMap = new Map([...stampedNodes, ...iNodes].map((n) => [n.id, n]));

  // areas
  const areaMap = new Map();
  for (const n of stampedNodes) {
    if (!n.filePath) continue;
    const { id, name } = areaOf(n.filePath);
    if (!areaMap.has(id)) areaMap.set(id, { id, name, description: `Files under ${name}/`, nodeIds: [] });
    areaMap.get(id).nodeIds.push(n.id);
  }
  const areas = [...areaMap.values()].sort((a, b) => a.name.localeCompare(b.name)).map((area) => {
    const status = areaCoverage(area, nodeMap);
    const sev = worstSeverity(area.nodeIds.map((id) => nodeMap.get(id)?.assessment?.worstSeverity).filter(Boolean));
    return { ...area, coverageStatus: status, worstSeverity: sev };
  });

  const coverage = buildCoverageManifest(stampedNodes, areas, findings, nodeMap);
  const summary = summarize(findings, coverage.headlineTrust, hasIntent, assessedFiles.length, componentNodes.length);

  const graph = {
    version: "2.0.0", kind: "assessment", binding,
    project: {
      name: path.basename(repoRoot), languages, frameworks: detectFrameworks(repoRoot),
      description: hasIntent ? "intent-bound assessment" : "baseline-only assessment (no confirmed intent supplied)",
      analyzedAt: generated, gitCommitHash: commit,
    },
    intents: iNodes, nodes: stampedNodes, edges: [...factEdges, ...gapEdges],
    findings, areas, coverage, summary,
  };

  // VALIDATE before publishing. The engine must never hand back — let alone write
  // to disk — a graph that violates the structural or honesty contract. This is
  // the same validator CI and the MCP server run, so there is a single source of
  // truth for what "valid" means.
  const { validate } = require(VALIDATOR_PATH);
  const verdict = validate(graph);
  if (verdict.errors.length) {
    throw new Error(
      `assess: assembled graph failed validation (${verdict.errors.length} error(s)); refusing to publish:\n  - ` +
        verdict.errors.join("\n  - "),
    );
  }

  // WRITE atomically: serialize to a temp file in the SAME directory, then rename.
  // rename(2) is atomic on a single filesystem, so a reader (dashboard, hook, MCP
  // consumer) never observes a half-written or invalid assessment-graph.json.
  let outPath = null;
  if (opts.outDir) {
    const dir = path.resolve(opts.outDir);
    fs.mkdirSync(dir, { recursive: true });
    outPath = path.join(dir, "assessment-graph.json");
    const tmpPath = path.join(dir, `.assessment-graph.${process.pid}.tmp`);
    fs.writeFileSync(tmpPath, JSON.stringify(graph, null, 2));
    fs.renameSync(tmpPath, outPath);
  }

  return { graph, outPath, summary: { ...summary, hasIntent, files: assessedFiles.length, nodes: stampedNodes.length, findings: findings.length } };
}

// ---------- assemble helpers ----------

function deriveOwnership(nodeId, edges, capabilityOwns = new Set()) {
  const claimed = capabilityOwns.has(nodeId);
  const inbound = edges.filter((e) => e.target === nodeId);
  const owners = new Set(inbound.filter((e) => e.type === "owns").map((e) => e.source));
  const isInfra = inbound.some((e) => e.type === "configures" || e.type === "routes");

  if (claimed && owners.size === 0) return "overclaimed";
  if (owners.size > 1) return "shared";
  if (owners.size === 1) return "owned";
  if (isInfra) return "infrastructure";
  if (inbound.length === 0) return "unowned";
  return "hidden";
}

function areaCoverage(area, nodes) {
  const order = ["assessed", "partial", "coverage_insufficient", "not_assessed"];
  let worst = "assessed", counted = 0;
  for (const id of area.nodeIds) {
    const n = nodes.get(id);
    if (!n || n.type === "intent" || n.type === "capability") continue;
    counted++;
    const st = n.assessment?.coverageStatus ?? "not_assessed";
    if (order.indexOf(st) > order.indexOf(worst)) worst = st;
  }
  return counted === 0 ? "not_assessed" : worst;
}

function buildCoverageManifest(nodes, areas, findings, nodeMap) {
  const byStatus = { assessed: 0, partial: 0, not_assessed: 0, coverage_insufficient: 0 };
  const assessable = nodes.filter((n) => n.type !== "intent" && n.type !== "capability");
  for (const n of assessable) byStatus[n.assessment?.coverageStatus ?? "not_assessed"]++;
  const gaps = [];
  for (const area of areas) {
    if (area.coverageStatus !== "assessed") {
      gaps.push({ scope: area.name, status: area.coverageStatus,
        reason: area.coverageStatus === "not_assessed" ? "no node in this area received a verdict"
          : area.coverageStatus === "coverage_insufficient" ? "index coverage too low to assess this area"
          : "nodes in this area are only partially assessed (e.g. baseline-only, no intent binding)" });
    }
  }
  for (const n of assessable) {
    const status = n.assessment?.coverageStatus ?? "not_assessed";
    if (status === "not_assessed" || status === "coverage_insufficient") {
      const reason = n.assessment?.notAssessedReason;
      if (reason) gaps.push({ scope: n.name || n.id, status, reason });
    }
  }
  return { totalAreas: areas.length, totalNodes: assessable.length, byStatus, headlineTrust: headlineTrust(findings), gaps };
}

function summarize(findings, trust, hasIntent, files, nodes) {
  const bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
  const byCategory = {};
  const byDirection = { intent_to_code: 0, code_to_intent: 0, baseline_to_code: 0 };
  for (const f of findings) { bySeverity[f.severity]++; byCategory[f.category] = (byCategory[f.category] ?? 0) + 1; byDirection[f.direction]++; }
  const mode = hasIntent ? "intent-bound" : "baseline-only (no confirmed intent)";
  const headline = `${mode}: scanned ${files} code files / ${nodes} nodes; ${bySeverity.P0} P0 / ${bySeverity.P1} P1 / ${bySeverity.P2} P2 / ${bySeverity.P3} P3 (headline trust: ${trust}).`;
  return { bySeverity, byCategory, byDirection, headline };
}

function resolveRelative(fromDir, imp, fileSet) {
  let base = path.posix.normalize(path.posix.join(fromDir, imp));
  const cands = [base, base + ".ts", base + ".tsx", base + ".js", base + ".jsx", base + ".mjs", base + ".cjs",
    base.replace(/\.js$/, ".ts"), base.replace(/\.js$/, ".tsx"),
    path.posix.join(base, "index.ts"), path.posix.join(base, "index.js"), path.posix.join(base, "index.tsx")];
  for (const c of cands) if (fileSet.has(c)) return c;
  return null;
}

function detectFrameworks(root) {
  const fw = [];
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    for (const [k, label] of [["react", "React"], ["next", "Next.js"], ["vue", "Vue"], ["express", "Express"], ["fastify", "Fastify"], ["vite", "Vite"], ["zod", "Zod"]]) if (deps[k]) fw.push(label);
  } catch {}
  return fw;
}

function gitCommit(root) {
  try { return execSync("git rev-parse --short HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "uncommitted"; }
  catch { return "uncommitted"; }
}
