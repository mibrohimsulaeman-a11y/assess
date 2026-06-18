import { createHash } from "node:crypto";
import type { SpanBinding } from "../types.js";

// Two hashes per cited span (VAC §14.3) so `reconcile` can tell a reformat from
// a real change:
//   span_sha256          — byte-exact; changes on whitespace, comments, CRLF
//   normalized_fingerprint — semantic; changes only on a real token/AST change
// If only the byte hash moved, the prior verdict is reused. If the fingerprint
// moved, the span is re-judged.

export function spanSha256(source: string): string {
  return "sha256:" + createHash("sha256").update(source, "utf8").digest("hex");
}

/**
 * Normalize source for semantic fingerprinting. This is a language-agnostic
 * approximation (the real core would use the per-language tokenizer): collapse
 * whitespace, strip line/block comments, drop trailing commas. It deliberately
 * ignores formatting so a prettier run does not trigger a re-judge.
 */
export function normalizeSource(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block comments
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1") // line comments (naive; keeps URLs rare-case aside)
    .replace(/#[^\n]*/g, " ")             // hash comments (py/sh/yaml)
    .replace(/\s+/g, " ")                  // collapse whitespace
    .replace(/,\s*([)\]}])/g, "$1")        // trailing commas
    .trim();
}

export function normalizedFingerprint(source: string): string {
  return "nfp:" + createHash("sha256").update(normalizeSource(source), "utf8").digest("hex");
}

export function bindSpan(
  filePath: string,
  lineRange: [number, number],
  source: string,
): SpanBinding {
  return {
    filePath,
    lineRange,
    spanSha256: spanSha256(source),
    normalizedFingerprint: normalizedFingerprint(source),
  };
}

export type ReconcileVerdict = "reuse" | "rejudge" | "retire";

/**
 * Decide what reconcile should do with a previously-bound span given the
 * current source at its location (or null if the code is gone).
 */
export function reconcileSpan(
  prior: SpanBinding,
  currentSource: string | null,
): ReconcileVerdict {
  if (currentSource === null) return "retire";
  const nowFingerprint = normalizedFingerprint(currentSource);
  if (nowFingerprint === prior.normalizedFingerprint) return "reuse"; // only reformatted
  return "rejudge";
}
