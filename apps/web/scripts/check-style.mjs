// Checks the stylesheet against the sharp look: no rounded corners outside the phone,
// no shadows, no gradients (except the dotted link and the carousel edge fade), no bouncy easing.
//   node scripts/check-style.mjs
// The same check is exported for the tests.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Selectors that belong to the phone and the call on it. Only these may be rounded. */
export const PHONE_SELECTORS = [".phone", ".pscreen", ".isl", ".video", ".cap", ".fctl", ".sig", ".fscreen"];

/** Returns a list of problems found in the css text. */
export function checkStyle(css) {
  const problems = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
  for (const [, selector, body] of rules) {
    const sel = selector.trim();
    if (/border-radius/.test(body) && !PHONE_SELECTORS.some((token) => sel.includes(token))) {
      problems.push(`border-radius outside the phone: ${sel}`);
    }
    if (/box-shadow|drop-shadow/.test(body)) problems.push(`shadow: ${sel}`);
    const gradients = body.match(/(repeating-)?(linear|radial|conic)-gradient/g) ?? [];
    for (const gradient of gradients) {
      const allowed = gradient.startsWith("repeating") || /mask-image/.test(body);
      if (!allowed) problems.push(`gradient: ${sel}`);
    }
  }
  if (/cubic-bezier\([^)]*,\s*(1\.\d+|[2-9])\s*,[^)]*\)/.test(text)) problems.push("bouncy easing (a control point above 1)");
  return problems;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = checkStyle(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"));
  if (problems.length) {
    console.error("check:style failed\n" + problems.map((p) => "  " + p).join("\n"));
    process.exit(1);
  }
  console.log("check:style ok");
}
