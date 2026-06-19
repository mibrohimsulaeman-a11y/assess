#!/usr/bin/env node
/* Regression tests for semantic fingerprint normalization. */

(async () => {
  const { normalizeSource } = await import("../runtime/engine.mjs");
  const cases = [
    {
      name: "keeps hash anchors inside string literals",
      source: 'const url = "https://x.test/a#b";',
      includes: '"https://x.test/a#b"',
    },
    {
      name: "keeps double slashes inside string literals",
      source: 'const s = "a//b";',
      includes: '"a//b"',
    },
    {
      name: "removes normal line comments",
      source: "const x = 1; // comment",
      equals: "const x = 1;",
    },
    {
      name: "removes normal block comments",
      source: "/* block */ const x = 1",
      equals: "const x = 1",
    },
    {
      name: "removes line-start hash comments conservatively",
      source: "# comment\nconst x = 1;",
      equals: "const x = 1;",
    },
    {
      name: "does not remove inline hash outside string literals",
      source: "const x = 1 # not-a-portable-comment",
      includes: "# not-a-portable-comment",
    },
  ];

  let failures = 0;
  for (const c of cases) {
    const normalized = normalizeSource(c.source);
    const ok = c.equals !== undefined
      ? normalized === c.equals
      : normalized.includes(c.includes);
    if (ok) {
      console.log(`✓ ${c.name}`);
    } else {
      failures++;
      console.error(`✗ ${c.name} — got ${JSON.stringify(normalized)}`);
    }
  }

  if (failures) {
    console.error(`\n✗ ${failures} fingerprint normalization check(s) failed`);
    process.exit(1);
  }
  console.log("\n✓ all fingerprint normalization checks passed");
})().catch((e) => {
  console.error("fingerprint normalization test crashed:", e.message);
  process.exit(1);
});
