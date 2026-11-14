import { writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MacAction } from "../../../../../services/api/src/contracts.js";
import { desktopExecutor } from "../../../../../services/api/src/mock-mac/executors.js";

// desktopExecutor spawns scrot/identify/convert/xdotool through execFile, which only
// exists on Linux. node:child_process is faked so the commands are recorded and the
// "captured" files are written where the executor looks for them.

const calls: Array<{ file: string; args: string[] }> = [];
let failures: Record<string, unknown | ((args: string[]) => unknown)> = {};

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

vi.mock("node:child_process", () => ({
  execFile: (file: string, args: string[], ...rest: unknown[]) => {
    calls.push({ file, args });
    const callback = rest.find((arg) => typeof arg === "function") as
      | ((error: unknown, result?: { stdout: string }) => void)
      | undefined;
    const failure = failures[file];
    const fail = typeof failure === "function" ? failure(args) : failure;
    queueMicrotask(async () => {
      if (fail) {
        callback?.(fail);
        return;
      }
      let stdout = "";
      if (file === "identify") stdout = "1920 1080";
      if (file === "convert") await writeFile(args[args.length - 1]!, jpeg(1280, 720));
      callback?.(null, { stdout });
    });
    return {
      once(event: string, cb: () => void) {
        if (event === "spawn") queueMicrotask(() => cb());
        return this;
      },
      unref() {},
    };
  },
}));

beforeEach(() => {
  calls.length = 0;
  failures = {};
});

const xdotool = () => calls.filter((c) => c.file === "xdotool").map((c) => c.args);

describe("desktopExecutor", () => {
  it("captures and resizes the screen through scrot/identify/convert", async () => {
    const executor = desktopExecutor();
    const shot = await executor.screenshot();
    expect(shot).toMatchObject({ mediaType: "image/jpeg", width: 1280, height: 720 });
    expect(calls.map((c) => c.file)).toEqual(["scrot", "identify", "convert"]);
  });

  it("waits and no-ops screenshots", async () => {
    const executor = desktopExecutor();
    expect(await executor.execute({ type: "wait", seconds: 0 } as MacAction)).toEqual({ ok: true, output: "OK" });
    expect(await executor.execute({ type: "screenshot" } as MacAction)).toEqual({ ok: true, output: "OK" });
  });

  it("opens urls and browser apps detached", async () => {
    const executor = desktopExecutor();
    await executor.execute({ type: "openUrl", url: "https://example.com" } as MacAction);
    await executor.execute({ type: "openApp", name: "Google Chrome" } as MacAction);
    expect(calls.map((c) => c.file)).toEqual(["google-chrome", "google-chrome"]);
    expect(calls[0]!.args).toEqual(["https://example.com"]);
  });

  it("rejects apps outside the mock list", async () => {
    const executor = desktopExecutor();
    expect(await executor.execute({ type: "openApp", name: "Notes" } as MacAction)).toEqual({
      ok: false,
      error: "App not available on this mock Mac: Notes",
    });
  });

  it("requires a screenshot before input actions", async () => {
    const executor = desktopExecutor();
    expect(await executor.execute({ type: "click", x: 1, y: 1, button: "left", clicks: 1 } as MacAction)).toEqual({
      ok: false,
      error: "Take a screenshot before executing actions.",
    });
  });

  it("maps a click to xdotool commands in original coordinates", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    // Screenshot is 1280x720 of a 1920x1080 desktop: coordinates scale x1.5.
    await executor.execute({ type: "click", x: 640, y: 360, button: "right", clicks: 2, modifiers: ["shift"] } as MacAction);
    expect(xdotool()).toEqual([
      ["mousemove", "960", "540"],
      ["keydown", "Shift_L"],
      ["click", "--repeat", "2", "3"],
      ["keyup", "Shift_L"],
    ]);
  });

  it("still attempts keyup when the click itself fails", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    failures.xdotool = (args: string[]) => (args[0] === "click" ? new Error("xdotool died") : undefined);
    const result = await executor.execute({ type: "click", x: 1, y: 1, button: "left", clicks: 1, modifiers: ["ctrl"] } as MacAction);
    expect(result).toEqual({ ok: false, error: "xdotool died" });
    expect(xdotool().some((args) => args[0] === "keyup")).toBe(true);
  });

  it("drags with the button held", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    await executor.execute({ type: "drag", fromX: 0, fromY: 0, toX: 100, toY: 50, modifiers: [] } as MacAction);
    expect(xdotool()).toEqual([
      ["mousemove", "0", "0"],
      ["mousedown", "1"],
      ["mousemove", "150", "75"],
      ["mouseup", "1"],
    ]);
  });

  it("scrolls with and without a pointer move", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    await executor.execute({ type: "scroll", direction: "up", amount: 2, x: null, y: null, modifiers: [] } as MacAction);
    await executor.execute({ type: "scroll", direction: "left", amount: 3, x: 10, y: 20, modifiers: [] } as MacAction);
    expect(xdotool()).toEqual([
      ["click", "--repeat", "2", "4"],
      ["mousemove", "15", "30"],
      ["click", "--repeat", "3", "6"],
    ]);
  });

  it("types and presses keys", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    await executor.execute({ type: "type", text: "hi" } as MacAction);
    await executor.execute({ type: "key", keys: "cmd+return", repeat: 1 } as MacAction);
    expect(xdotool()).toEqual([
      ["type", "--delay", "12", "--", "hi"],
      ["key", "--repeat", "1", "ctrl+Return"],
    ]);
  });

  it("moves the mouse", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    await executor.execute({ type: "mouseMove", x: 10, y: 10 } as MacAction);
    expect(xdotool()).toEqual([["mousemove", "15", "15"]]);
  });

  it("rejects unsupported actions and surfaces spawn errors", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    expect(await executor.execute({ type: "teleport" } as unknown as MacAction)).toEqual({
      ok: false,
      error: "Unsupported mock Mac action.",
    });
    failures["google-chrome"] = new Error("cannot run");
    expect(await executor.execute({ type: "openUrl", url: "https://x.co" } as MacAction)).toEqual({
      ok: false,
      error: "cannot run",
    });
    failures.xdotool = "weird";
    const result = await executor.execute({ type: "type", text: "a" } as MacAction);
    expect(result).toEqual({ ok: false, error: "Mock Mac action failed." });
  });
});

describe("desktopExecutor modifier chords", () => {
  it("holds mapped modifiers through a drag", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    // cmd->ctrl, option->alt and a pass-through modifier exercise every mapping branch.
    await executor.execute({ type: "drag", fromX: 0, fromY: 0, toX: 10, toY: 10, modifiers: ["cmd", "option", "meta"] } as MacAction);
    expect(xdotool()).toEqual([
      ["keydown", "Control_L"],
      ["keydown", "Alt_L"],
      ["keydown", "meta"],
      ["mousemove", "0", "0"],
      ["mousedown", "1"],
      ["mousemove", "15", "15"],
      ["mouseup", "1"],
      ["keyup", "meta"],
      ["keyup", "Alt_L"],
      ["keyup", "Control_L"],
    ]);
  });

  it("releases modifiers after a scroll even when it fails", async () => {
    const executor = desktopExecutor();
    await executor.screenshot();
    failures.xdotool = (args: string[]) => (args[0] === "click" ? new Error("scroll died") : undefined);
    const result = await executor.execute({ type: "scroll", direction: "down", amount: 1, x: null, y: null, modifiers: ["shift"] } as MacAction);
    expect(result).toEqual({ ok: false, error: "scroll died" });
    expect(xdotool()).toEqual([
      ["keydown", "Shift_L"],
      ["click", "--repeat", "1", "5"],
      ["keyup", "Shift_L"],
    ]);
  });
});

describe("macExecutor default run seam", () => {
  it("resolves execFile stdout and fails on an empty screen size", async () => {
    // The mocked execFile answers osascript with "", so getScreenSize cannot
    // parse a "WxH" line and rejects.
    const { macExecutor } = await import("../../../../../services/api/src/mock-mac/executors.js");
    await expect(macExecutor().screenshot()).rejects.toThrow("Could not determine the Mac screen size.");
  });
});
