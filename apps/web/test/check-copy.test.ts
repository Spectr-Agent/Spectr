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
    ["Hello there", "all lowercase"],
    ["spectr and Mac", "all lowercase"],
    ["a-b", "no dashes or hyphens"],
    ["one – two", "no dashes or hyphens"],
    ["one — two", "no dashes or hyphens"],
    ["one; two", "no semicolons"],
    ["it actually works.", "never actually, genuinely or kind"],
    ["genuinely good.", "never actually, genuinely or kind"],
    ["be kind.", "never actually, genuinely or kind"],
    ["wait while it runs.", "avoid while"],
    ["this rather than that.", "avoid rather than"],
    ["text instead of calling.", "avoid instead of"],
  ])("rejects %j", (text, rule) => {
    expect(rulesBrokenBy(text)).toContain(rule);
  });

  it("allows words that only contain the banned ones", () => {
    expect(rulesBrokenBy("kindly wait. meanwhile, relax. contractually fine.")).toEqual([]);
  });

  it("allows one exclamation point and rejects two", () => {
    expect(checkSource('const a = "hi!";')).toEqual([]);
    expect(checkSource('const a = "hi!", b = "yay!";').map((p) => p.rule)).toContain("at most 1 exclamation point on the page");
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
    const source = `import { x } from "@/Some-Module";\n// A-b; actually\n/* Kind of; while */\nconst ok = "fine.";`;
    expect(extractStrings(source).map((s) => s.value)).toEqual(["fine."]);
    expect(checkSource(source)).toEqual([]);
  });

  it("reads strings that contain comment markers", () => {
    expect(extractStrings('const url = "https://example.com";').map((s) => s.value)).toEqual(["https://example.com"]);
  });

  it("research: 3 big numbers and 11 more, each with a source", async () => {
    const { copy } = await import("../content/copy");
    expect(copy.research.big.length + copy.more.facts.length).toBe(14);
    for (const item of [...copy.research.big, ...copy.more.facts]) {
      expect(item.source.length).toBeGreaterThan(3);
      expect(item.text.length).toBeGreaterThan(10);
    }
  });

  it("every research source has a slot in sources.ts", async () => {
    const { copy } = await import("../content/copy");
    const { sourceLinks } = await import("../lib/sources");
    for (const item of [...copy.research.big, ...copy.more.facts]) expect(Object.keys(sourceLinks)).toContain(item.link);
  });
});
