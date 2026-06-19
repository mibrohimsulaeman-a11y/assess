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

function stripComments(source: string): string {
  let out = "";
  let state: "normal" | "single_quote" | "double_quote" | "template" | "line_comment" | "block_comment" = "normal";
  let escaped = false;
  let lineStart = true;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    const next = source[i + 1] ?? "";

    if (state === "line_comment") {
      if (ch === "\n") {
        out += ch;
        state = "normal";
        lineStart = true;
      }
      continue;
    }
    if (state === "block_comment") {
      if (ch === "*" && next === "/") {
        i++;
        state = "normal";
      }
      continue;
    }
    if (state === "single_quote" || state === "double_quote" || state === "template") {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (state === "single_quote" && ch === "'") state = "normal";
      else if (state === "double_quote" && ch === '"') state = "normal";
      else if (state === "template" && ch === "`") state = "normal";
      continue;
    }

    if (ch === "/" && next === "/") {
      state = "line_comment";
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      if (!out.endsWith(" ") && !out.endsWith("\n")) out += " ";
      state = "block_comment";
      i++;
      continue;
    }
    if (ch === "#" && lineStart) {
      state = "line_comment";
      continue;
    }
    if (ch === "'") state = "single_quote";
    else if (ch === '"') state = "double_quote";
    else if (ch === "`") state = "template";

    out += ch;
    if (ch === "\n") lineStart = true;
    else if (!/\s/.test(ch)) lineStart = false;
  }
  return out;
}

function collapseWhitespaceOutsideStrings(source: string): string {
  let out = "";
  let state: "normal" | "single_quote" | "double_quote" | "template" = "normal";
  let escaped = false;
  let pendingSpace = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (state === "single_quote" || state === "double_quote" || state === "template") {
      if (pendingSpace && out && !out.endsWith(" ")) {
        out += " ";
        pendingSpace = false;
      }
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (state === "single_quote" && ch === "'") state = "normal";
      else if (state === "double_quote" && ch === '"') state = "normal";
      else if (state === "template" && ch === "`") state = "normal";
      continue;
    }

    if (/\s/.test(ch)) {
      pendingSpace = true;
      continue;
    }
    if (pendingSpace && out && !out.endsWith(" ")) out += " ";
    pendingSpace = false;

    if (ch === "'") state = "single_quote";
    else if (ch === '"') state = "double_quote";
    else if (ch === "`") state = "template";
    out += ch;
  }
  return out.trim();
}

function stripTrailingCommasOutsideStrings(source: string): string {
  let out = "";
  let state: "normal" | "single_quote" | "double_quote" | "template" = "normal";
  let escaped = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i] ?? "";
    if (state === "single_quote" || state === "double_quote" || state === "template") {
      out += ch;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (state === "single_quote" && ch === "'") state = "normal";
      else if (state === "double_quote" && ch === '"') state = "normal";
      else if (state === "template" && ch === "`") state = "normal";
      continue;
    }

    if (ch === "'") state = "single_quote";
    else if (ch === '"') state = "double_quote";
    else if (ch === "`") state = "template";

    if (state === "normal" && ch === ",") {
      let j = i + 1;
      while (j < source.length && /\s/.test(source[j] ?? "")) j++;
      if (j < source.length && ")]}".includes(source[j] ?? "")) {
        i = j - 1;
        continue;
      }
    }
    out += ch;
  }
  return out.trim();
}

/**
 * Normalize source for semantic fingerprinting. This is a lightweight,
 * language-agnostic tokenizer: comments are stripped only in normal code state,
 * while string and template literal contents are preserved. It deliberately
 * ignores formatting so a prettier run does not trigger a re-judge.
 */
export function normalizeSource(source: string): string {
  return stripTrailingCommasOutsideStrings(
    collapseWhitespaceOutsideStrings(stripComments(source)),
  );
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
