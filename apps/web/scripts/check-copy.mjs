// Scans content/copy.ts for the site's writing rules and fails the build when one breaks.
//   node scripts/check-copy.mjs
// The same checks are exported for the tests.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MAX_SENTENCE_WORDS = 24;
export const MAX_EXCLAMATIONS = 1;

/** Every string literal in a TypeScript file, skipping comments and import lines. */
export function extractStrings(source) {
  const code = source
    .split("\n")
    .map((line) => (/^\s*import\b/.test(line) ? "" : line))
    .join("\n");
  const strings = [];
  let i = 0;
  while (i < code.length) {
    const ch = code[i];
    const next = code[i + 1];
    if (ch === "/" && next === "/") {
      while (i < code.length && code[i] !== "\n") i += 1;
    } else if (ch === "/" && next === "*") {
      const end = code.indexOf("*/", i + 2);
      i = end === -1 ? code.length : end + 2;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      let value = "";
      i += 1;
      while (i < code.length && code[i] !== quote) {
        if (code[i] === "\\") {
          value += code[i + 1] ?? "";
          i += 2;
        } else {
          value += code[i];
          i += 1;
        }
      }
      i += 1;
      strings.push({ value, template: quote === "`" });
    } else {
      i += 1;
    }
  }
  return strings;
}

const RULES = [
  { name: "no dashes or hyphens", test: (s) => /[-‐-―−]/.test(s) },
  { name: "no semicolons", test: (s) => s.includes(";") },
  { name: "never actually, genuinely or kind", test: (s) => /\b(actually|genuinely|kind)\b/i.test(s) },
  { name: "avoid while", test: (s) => /\bwhile\b/i.test(s) },
  { name: "avoid rather than", test: (s) => /\brather than\b/i.test(s) },
  { name: "avoid instead of", test: (s) => /\binstead of\b/i.test(s) },
  {
    name: `sentences of ${MAX_SENTENCE_WORDS} words or fewer`,
    test: (s) => s.split(/(?<=[.?!])\s+/).some((sentence) => sentence.trim().split(/\s+/).length > MAX_SENTENCE_WORDS),
  },
];

/** Returns a list of problems. Empty means the copy passes. */
export function checkSource(source) {
  const problems = [];
  let exclamations = 0;
  for (const { value, template } of extractStrings(source)) {
    if (template && value.includes("${")) problems.push({ rule: "no template expressions in copy", text: value });
    for (const rule of RULES) if (rule.test(value)) problems.push({ rule: rule.name, text: value });
    exclamations += (value.match(/!/g) ?? []).length;
  }
  if (exclamations > MAX_EXCLAMATIONS) {
    problems.push({ rule: `at most ${MAX_EXCLAMATIONS} exclamation point on the page`, text: `found ${exclamations}` });
  }
  return problems;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const file = new URL("../content/copy.ts", import.meta.url);
  const problems = checkSource(readFileSync(file, "utf8"));
  if (problems.length === 0) {
    const count = extractStrings(readFileSync(file, "utf8")).length;
    console.log(`check:copy passed (${count} strings checked)`);
  } else {
    console.error("check:copy failed:");
    for (const p of problems) console.error(`  [${p.rule}] ${JSON.stringify(p.text)}`);
    process.exit(1);
  }
}
