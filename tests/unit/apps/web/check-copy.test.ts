import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSource, extractStrings } from "../../../../apps/web/scripts/check-copy.mjs";

describe("extractStrings", () => {
  it("collects quoted strings and skips imports and comments", () => {
    const source = `import x from "y";
// a "comment"
const a = "one";
const b = 'two';
const c = \`three\`;
/* block "comment" */`;
    const values = extractStrings(source).map((s) => s.value);
    expect(values).toEqual(["one", "two", "three"]);
    expect(extractStrings(source).some((s) => s.template)).toBe(true);
  });

  it("handles escapes and unterminated block comments", () => {
    expect(extractStrings('const a = "it\\"s";').map((s) => s.value)).toEqual(["it\"s"]);
    expect(extractStrings("/* never closed \"x\"")).toEqual([]);
  });
});

describe("checkSource", () => {
  it.each([
    ['const a = "it -- works";', "no dashes or hyphens"],
    ['const a = "one; two";', "no semicolons"],
    ['const a = "actually yes";', "never actually, genuinely or kind"],
    ['const a = "while it runs";', "avoid while"],
    ['const a = "rather than that";', "avoid rather than"],
    ['const a = "instead of this";', "avoid instead of"],
    [`const a = "${"word ".repeat(30)}done.";`, "sentences of 24 words or fewer"],
    ['const a = `hi ${"name"}`;', "no template expressions in copy"],
  ])("flags %s", (source, rule) => {
    expect(checkSource(source).some((p) => p.rule === rule)).toBe(true);
  });

  it("flags more than one exclamation point across the page", () => {
    expect(checkSource('const a = "hi!"; const b = "yo!";').some((p) => p.rule.includes("exclamation"))).toBe(true);
    expect(checkSource('const a = "clean copy.";')).toEqual([]);
  });
});

describe("check-copy main block", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  const importAsMain = async (source: string) => {
    vi.resetModules();
    vi.doMock("node:fs", async (importOriginal) => ({
      ...(await importOriginal<typeof import("node:fs")>()),
      readFileSync: () => source,
    }));
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const scriptPath = fileURLToPath(new URL("../../../../apps/web/scripts/check-copy.mjs", import.meta.url));
    const argv1 = process.argv[1];
    process.argv[1] = scriptPath;
    try {
      await import("../../../../apps/web/scripts/check-copy.mjs");
    } finally {
      process.argv[1] = argv1;
    }
    return exit;
  };

  it("passes clean copy and exits normally", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const exit = await importAsMain('const a = "clean copy.";\n');
    expect(exit).not.toHaveBeenCalled();
    expect(log.mock.calls[0]?.[0]).toContain("check:copy passed");
  });

  it("fails bad copy with exit 1", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const exit = await importAsMain('const a = "actually -- bad; copy";\n');
    expect(exit).toHaveBeenCalledWith(1);
  });
});
