import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  calculateScreenshotDimensions,
  fixtureExecutor,
  macExecutor,
  mapKeyComboToCliclick,
  mapKeyComboToXdotool,
  scaleCoordinate,
  type RunCommand,
} from "../../../../../services/api/src/mock-mac/executors.js";
import type { MacAction } from "../../../../../services/api/src/contracts.js";

const png = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
};

const jpeg = (width: number, height: number): Buffer => {
  const bytes = Buffer.alloc(24);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
};

describe("calculateScreenshotDimensions", () => {
  it.each([[0, 100], [100, 0], [1.5, 10], [10, 1.5], [-1, 5]])("rejects %ix%i", (w, h) => {
    expect(() => calculateScreenshotDimensions(w, h)).toThrow("positive integers");
  });

  it("shrinks to the 1280 edge limit", () => {
    expect(calculateScreenshotDimensions(2560, 1440)).toEqual({ width: 1280, height: 720 });
  });

  it("keeps small screenshots at size", () => {
    expect(calculateScreenshotDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("shrinks further when the token budget requires it", () => {
    const { width, height } = calculateScreenshotDimensions(1280, 1280);
    expect(Math.ceil(width / 28) * Math.ceil(height / 28)).toBeLessThanOrEqual(4784);
  });
});

describe("scaleCoordinate", () => {
  it("maps and clamps to the original size", () => {
    expect(scaleCoordinate(50, 1000, 100)).toBe(500);
    expect(scaleCoordinate(1000, 1000, 100)).toBe(999);
    expect(scaleCoordinate(-5, 1000, 100)).toBe(0);
  });
});

describe("mapKeyComboToXdotool", () => {
  it.each([
    ["cmd+c", ["key", "--repeat", "1", "ctrl+c"]],
    ["+", ["key", "--repeat", "1", "plus"]],
    ["return", ["key", "--repeat", "1", "Return"]],
    ["f5", ["key", "--repeat", "1", "F5"]],
    ["option+shift+option+left", ["key", "--repeat", "1", "alt+shift+Left"]],
  ])("maps %s", (combo, expected) => {
    expect(mapKeyComboToXdotool(combo)).toEqual(expected);
  });

  it("honours repeat", () => {
    expect(mapKeyComboToXdotool("tab", 3)).toEqual(["key", "--repeat", "3", "Tab"]);
  });
});

describe("mapKeyComboToCliclick", () => {
  it.each([
    ["return", 1, ["kp:return"]],
    ["f12", 1, ["kp:f12"]],
    ["a", 1, ["t:a"]],
    ["cmd+A", 1, ["kd:cmd", "t:a", "ku:cmd"]],
    ["cmd+shift+left", 1, ["kd:cmd,shift", "kp:arrow-left", "ku:cmd,shift"]],
    ["+", 1, ["t:+"]],
    ["cmd+c", 2, ["kd:cmd", "t:c", "ku:cmd", "kd:cmd", "t:c", "ku:cmd"]],
  ])("maps %s x%i", (combo, repeat, expected) => {
    expect(mapKeyComboToCliclick(combo, repeat)).toEqual(expected);
  });

  it.each([[0], [1.5], [-2]])("rejects repeat %i", (repeat) => {
    expect(() => mapKeyComboToCliclick("a", repeat)).toThrow("positive integer");
  });

  it("rejects an unsupported key", () => {
    expect(() => mapKeyComboToCliclick("f13")).toThrow("Unsupported Mac key");
  });
});

describe("fixtureExecutor", () => {
  it("reads a PNG screenshot once and records actions", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spectr-test-"));
    const path = join(directory, "shot.png");
    await writeFile(path, png(640, 480));
    const onAction = vi.fn();
    const executor = fixtureExecutor({ screenshotPath: path, onAction });
    const first = await executor.screenshot();
    expect(first).toMatchObject({ mediaType: "image/png", width: 640, height: 480 });
    expect(await executor.screenshot()).toBe(first);
    const action = { type: "wait", seconds: 0 } as MacAction;
    expect(await executor.execute(action)).toEqual({ ok: true, output: "OK" });
    expect(executor.actions).toEqual([action]);
    expect(onAction).toHaveBeenCalledWith(action);
  });

  it("rejects a file that is not a PNG or JPEG", async () => {
    const directory = await mkdtemp(join(tmpdir(), "spectr-test-"));
    const path = join(directory, "shot.bin");
    await writeFile(path, Buffer.from("not an image"));
    await expect(fixtureExecutor({ screenshotPath: path }).screenshot()).rejects.toThrow("PNG or JPEG");
  });
});

describe("macExecutor", () => {
  const calls: Array<{ file: string; args: string[] }> = [];
  const ENOENT = Object.assign(new Error("spawn cliclick ENOENT"), { code: "ENOENT" });

  /** A run stub that plays the Mac binaries: screen size, capture, resize and input. */
  const makeRun = (overrides: Partial<Record<string, (args: string[]) => Promise<{ stdout: string }>>> = {}): RunCommand => {
    return async (file, args) => {
      calls.push({ file, args });
      const custom = overrides[file];
      if (custom) return custom(args);
      if (file === "osascript" && args.some((arg) => arg.includes(macScreenSizeMarker))) return { stdout: "1440x900\n" };
      if (file === "screencapture") {
        await writeFile(args[3]!, png(2880, 1800));
        return { stdout: "" };
      }
      if (file === "sips") {
        await writeFile(args[args.length - 1]!, jpeg(1280, 800));
        return { stdout: "" };
      }
      return { stdout: "" };
    };
  };
  const macScreenSizeMarker = '$.NSScreen.mainScreen.frame';

  const executor = (runOverrides: Parameters<typeof makeRun>[0] = {}, sleep = vi.fn(async () => {})) => {
    calls.length = 0;
    return { executor: macExecutor({ run: makeRun(runOverrides), sleep }), sleep };
  };

  const cliclickArgs = () => calls.filter((c) => c.file === "cliclick").map((c) => c.args);

  it("captures, resizes and reports the screenshot", async () => {
    const { executor: e } = executor();
    const shot = await e.screenshot();
    expect(shot).toMatchObject({ mediaType: "image/jpeg", width: 1280, height: 800 });
    expect(calls.map((c) => c.file)).toEqual(["osascript", "screencapture", "sips"]);
  });

  it("translates a screen permission failure into a readable error", async () => {
    const { executor: e } = executor({ screencapture: async () => Promise.reject(new Error("denied")) });
    await expect(e.screenshot()).rejects.toThrow("Screen Recording");
  });

  it("rejects an unreadable screen size", async () => {
    const { executor: e } = executor({ osascript: async () => ({ stdout: "garbage" }) });
    await expect(e.screenshot()).rejects.toThrow("Mac screen size");
  });

  it("rejects a zero screen size", async () => {
    const { executor: e } = executor({ osascript: async () => ({ stdout: "0x900" }) });
    await expect(e.screenshot()).rejects.toThrow("Mac screen size");
  });

  it("waits with the injected sleep and no-ops screenshots", async () => {
    const { executor: e, sleep } = executor();
    expect(await e.execute({ type: "wait", seconds: 2 } as MacAction)).toEqual({ ok: true, output: "OK" });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(await e.execute({ type: "screenshot" } as MacAction)).toEqual({ ok: true, output: "OK" });
  });

  it.each([["-weird"], ["ftp://host"], ["file:///etc"]])("rejects url %s", async (url) => {
    const { executor: e } = executor();
    const result = await e.execute({ type: "openUrl", url } as MacAction);
    expect(result).toEqual({ ok: false, error: "Only HTTP and HTTPS URLs can be opened." });
  });

  it("opens http urls", async () => {
    const { executor: e } = executor();
    expect(await e.execute({ type: "openUrl", url: "https://example.com" } as MacAction)).toEqual({ ok: true, output: "OK" });
    expect(calls.at(-1)).toEqual({ file: "open", args: ["https://example.com"] });
  });

  it.each([["-bad"], ["a/b"], ["xy"]])("rejects app name %j", async (name) => {
    const { executor: e } = executor();
    expect(await e.execute({ type: "openApp", name } as MacAction)).toEqual({ ok: false, error: "Invalid app name." });
  });

  it("opens apps and reports launch failures", async () => {
    const { executor: e } = executor();
    expect(await e.execute({ type: "openApp", name: "Notes" } as MacAction)).toEqual({ ok: true, output: "OK" });
    const { executor: failing } = executor({ open: async () => Promise.reject(new Error("nope")) });
    expect(await failing.execute({ type: "openApp", name: "Notes" } as MacAction)).toEqual({
      ok: false,
      error: "Couldn't open app Notes.",
    });
  });

  it("types text with kp:return between lines", async () => {
    const { executor: e } = executor();
    await e.execute({ type: "type", text: "one\n\nthree" } as MacAction);
    expect(cliclickArgs()).toEqual([["t:one", "kp:return", "kp:return", "t:three"]]);
  });

  it("skips cliclick for empty text", async () => {
    const { executor: e } = executor();
    await e.execute({ type: "type", text: "" } as MacAction);
    expect(cliclickArgs()).toEqual([]);
  });

  it("presses keys through cliclick", async () => {
    const { executor: e } = executor();
    await e.execute({ type: "key", keys: "cmd+space", repeat: 1 } as MacAction);
    expect(cliclickArgs()).toEqual([["kd:cmd", "kp:space", "ku:cmd"]]);
  });

  it("rejects middle click and repeated right click", async () => {
    const { executor: e } = executor();
    expect(await e.execute({ type: "click", x: 1, y: 1, button: "middle", clicks: 1 } as MacAction)).toEqual({
      ok: false,
      error: "Middle click is not supported on macOS.",
    });
    expect(await e.execute({ type: "click", x: 1, y: 1, button: "right", clicks: 2 } as MacAction)).toEqual({
      ok: false,
      error: "right click supports one click",
    });
  });

  it.each([
    [{ button: "left", clicks: 1 }, "c:"],
    [{ button: "left", clicks: 2 }, "dc:"],
    [{ button: "left", clicks: 3 }, "tc:"],
    [{ button: "right", clicks: 1 }, "rc:"],
  ])("clicks %j as %s", async (click, command) => {
    const { executor: e } = executor();
    await e.screenshot();
    await e.execute({ type: "click", x: 100, y: 100, modifiers: [], ...click } as MacAction);
    expect(cliclickArgs().at(-1)![0]).toMatch(new RegExp(`^${command.replace(":", "\\:")}\\d+,\\d+$`));
  });

  it("holds modifiers while clicking", async () => {
    const { executor: e } = executor();
    await e.screenshot();
    await e.execute({ type: "click", x: 5, y: 5, button: "left", clicks: 1, modifiers: ["shift"] } as MacAction);
    expect(cliclickArgs().at(-1)).toEqual(["kd:shift", "c:6,6", "ku:shift"]);
  });

  it("moves and drags the pointer in screen coordinates", async () => {
    const { executor: e } = executor();
    await e.screenshot();
    await e.execute({ type: "mouseMove", x: 1280, y: 800 } as MacAction);
    await e.execute({ type: "drag", fromX: 0, fromY: 0, toX: 640, toY: 400, modifiers: ["cmd"] } as MacAction);
    const args = cliclickArgs();
    expect(args[0]).toEqual(["m:1439,899"]);
    expect(args[1]).toEqual(["-w", "50", "kd:cmd", "dd:0,0", "m:720,450", "du:720,450", "ku:cmd"]);
  });

  it.each([
    ["down", null, null, ["-5", "0"]],
    ["up", null, null, ["5", "0"]],
    ["right", null, null, ["0", "-5"]],
    ["left", 10, 20, ["0", "5"]],
  ])("scrolls %s", async (direction, x, y, osascriptTail) => {
    const { executor: e } = executor();
    await e.screenshot();
    await e.execute({ type: "scroll", direction, amount: 5, x, y, modifiers: ["ctrl"] } as MacAction);
    const scroll = calls.find((c) => c.file === "osascript" && !c.args.some((a) => a.includes(macScreenSizeMarker)))!;
    expect(scroll.args.slice(-2)).toEqual(osascriptTail);
    const clicks = cliclickArgs();
    if (x !== null) {
      expect(clicks[0]).toEqual([expect.stringMatching(/^m:\d+,\d+$/)]);
      expect(clicks[1]).toEqual(["kd:ctrl"]);
    } else {
      expect(clicks[0]).toEqual(["kd:ctrl"]);
    }
    expect(clicks.at(-1)).toEqual(["ku:ctrl"]);
  });

  it("scrolls without modifiers or a pointer move", async () => {
    const { executor: e } = executor();
    await e.screenshot();
    await e.execute({ type: "scroll", direction: "down", amount: 3, x: null, y: null, modifiers: [] } as MacAction);
    expect(cliclickArgs()).toEqual([]);
  });

  it("explains a missing cliclick", async () => {
    const { executor: e } = executor({ cliclick: async () => Promise.reject(ENOENT) });
    const result = await e.execute({ type: "type", text: "hi" } as MacAction);
    expect(result).toEqual({ ok: false, error: "cliclick is not installed. Run: brew install cliclick" });
  });

  it("returns the underlying error text, and a default for non-Error throws", async () => {
    const { executor: e } = executor({ open: async () => Promise.reject(new Error("custom failure")) });
    const result = await e.execute({ type: "openUrl", url: "https://x.co" } as MacAction);
    expect(result).toEqual({ ok: false, error: "custom failure" });

    const { executor: weird } = executor({ open: async () => Promise.reject("nope" as never) });
    const odd = await weird.execute({ type: "openUrl", url: "https://x.co" } as MacAction);
    expect(odd).toEqual({ ok: false, error: "Mac action failed." });

    const { executor: weird2 } = executor({ cliclick: async () => Promise.reject("nope" as never) });
    const odd2 = await weird2.execute({ type: "type", text: "hi" } as MacAction);
    expect(odd2).toEqual({ ok: false, error: "Mac action failed." });
  });

  it("rejects actions outside the vocabulary", async () => {
    const { executor: e } = executor();
    const result = await e.execute({ type: "teleport" } as unknown as MacAction);
    expect(result).toEqual({ ok: false, error: "Unsupported Mac action." });
  });
});

describe("JPEG marker edge cases", () => {
  const jpegBytes = async (segments: number[]) => {
    const dir = await mkdtemp(join(tmpdir(), "spectr-jpeg-"));
    const path = join(dir, "shot.jpg");
    await writeFile(path, Buffer.from(segments));
    return fixtureExecutor({ screenshotPath: path }).screenshot();
  };

  it("skips non-marker bytes and SOI/EOI markers", async () => {
    const shot = await jpegBytes([
      0xff, 0xd8, 0x00, 0x11, 0xff, 0xd9, 0xff, 0xe0, 0x00, 0x04, 0x99, 0x99, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x64, 0x00, 0x32,
    ]);
    expect(shot).toMatchObject({ height: 100, width: 50 });
  });

  it.each([
    [[0xff, 0xd8, 0xff, 0xa0], "truncated marker"],
    [[0xff, 0xd8, 0xff, 0xa0, 0x00, 0x00, 0xff, 0xff, 0xff, 0xc0], "undersized segment"],
    [[0xff, 0xd8, 0xff, 0xa0, 0x00, 0x14, 0x99], "segment longer than the file"],
  ])("rejects a malformed jpeg (%s)", async (bytes) => {
    await expect(jpegBytes(bytes)).rejects.toThrow("PNG or JPEG");
  });
});

describe("macExecutor injected and default seams", () => {
  it("returns ok:false when the screenshot cannot be produced", async () => {
    const executor = macExecutor({ run: async () => { throw new Error("no osascript"); } });
    await expect(executor.execute({ type: "click", x: 1, y: 1, button: "left", clicks: 1, modifiers: [] }))
      .resolves.toEqual({ ok: false, error: "no osascript" });
  });

  it("uses the default sleep seam for wait actions", async () => {
    await expect(macExecutor().execute({ type: "wait", seconds: 0.001 })).resolves.toMatchObject({ ok: true });
  });
});

describe("calculateScreenshotDimensions budget", () => {
  it("keeps a large screenshot within the token budget", () => {
    const size = calculateScreenshotDimensions(2560, 2560);
    expect(Math.ceil(size.width / 28) * Math.ceil(size.height / 28)).toBeLessThanOrEqual(4784);
  });
});

describe("mapKeyComboToXdotool modifiers", () => {
  it("maps ctrl, alt and shift modifiers to xdotool names", () => {
    expect(mapKeyComboToXdotool("ctrl+alt+shift+a")).toEqual(["key", "--repeat", "1", "ctrl+alt+shift+a"]);
  });
});
