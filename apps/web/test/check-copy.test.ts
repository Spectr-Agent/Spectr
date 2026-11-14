import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkSource, extractStrings } from "../scripts/check-copy.mjs";

const rulesBrokenBy = (text: string) => checkSource(`const x = ${JSON.stringify(text)};`).map((p) => p.rule);

describe("check:copy", () => {
  it("the real copy passes every rule", () => {
    const source = readFileSync(new URL("../content/copy.ts", import.meta.url), "utf8");
    expect(checkSource(source)).toEqual([]);
    expect(extractStrings(source).length).toBeGreaterThan(150);
  });

  it.each([
    ["a-b", "no dashes or hyphens"],
    ["one – two", "no dashes or hyphens"],
    ["one — two", "no dashes or hyphens"],
    ["one; two", "no semicolons"],
    ["It actually works.", "never actually, genuinely or kind"],
    ["Genuinely good.", "never actually, genuinely or kind"],
    ["Be kind.", "never actually, genuinely or kind"],
    ["Wait while it runs.", "avoid while"],
    ["This rather than that.", "avoid rather than"],
    ["Text instead of calling.", "avoid instead of"],
  ])("rejects %j", (text, rule) => {
    expect(rulesBrokenBy(text)).toContain(rule);
  });

  it("allows words that only contain the banned ones", () => {
    expect(rulesBrokenBy("Kindly wait. Meanwhile, relax. Contractually fine.")).toEqual([]);
  });

  it("allows one exclamation point and rejects two", () => {
    expect(checkSource('const a = "Hi!";')).toEqual([]);
    expect(checkSource('const a = "Hi!", b = "Yay!";').map((p) => p.rule)).toContain("at most 1 exclamation point on the page");
  });

  it("rejects a sentence of more than 24 words", () => {
    const long = Array.from({ length: 25 }, () => "word").join(" ") + ".";
    expect(rulesBrokenBy(long)).toContain("sentences of 24 words or fewer");
    expect(rulesBrokenBy(Array.from({ length: 24 }, () => "word").join(" ") + ".")).toEqual([]);
  });

  it("rejects template expressions", () => {
    expect(checkSource("const a = `hello ${name}`;").map((p) => p.rule)).toContain("no template expressions in copy");
  });

  it("ignores comments and import lines", () => {
    const source = `import { x } from "@/some-module";\n// a-b; actually\n/* kind of; while */\nconst ok = "Fine.";`;
    expect(extractStrings(source).map((s) => s.value)).toEqual(["Fine."]);
    expect(checkSource(source)).toEqual([]);
  });

  it("reads strings that contain comment markers", () => {
    expect(extractStrings('const url = "https://example.com";').map((s) => s.value)).toEqual(["https://example.com"]);
  });
});
