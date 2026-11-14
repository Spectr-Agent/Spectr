import { writeFile } from "node:fs/promises";
import {
  calculateScreenshotDimensions,
  macExecutor,
  mapKeyComboToCliclick,
  scaleCoordinate,
} from "../src/mock-mac/executors.js";
import { describe, expect, it } from "vitest";

interface CommandCall {
  file: string;
  args: string[];
}

function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpegHeader(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(21);
  bytes.writeUInt16BE(0xffd8, 0);
  bytes[2] = 0xff;
  bytes[3] = 0xc0;
  bytes.writeUInt16BE(17, 4);
  bytes[6] = 8;
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function makeExecutor(options?: { failCliclick?: boolean }): {
  executor: ReturnType<typeof macExecutor>;
  calls: CommandCall[];
} {
  const calls: CommandCall[] = [];
  const run = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (options?.failCliclick && file === "cliclick") {
      const error = new Error("spawn cliclick ENOENT") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      throw error;
    }
    if (file === "osascript") {
      const scriptIndex = args.indexOf("-e");
      if (args[scriptIndex + 1]?.includes("AppKit")) {
        return { stdout: "1512x982\n" };
      }
      return { stdout: "ok" };
    }
    if (file === "screencapture") {
      await writeFile(args[args.length - 1]!, pngHeader(3024, 1964));
      return { stdout: "" };
    }
    if (file === "sips") {
      const sizeIndex = args.indexOf("-z");
      const outputPath = args[args.indexOf("--out") + 1]!;
      await writeFile(
        outputPath,
        jpegHeader(Number(args[sizeIndex + 2]), Number(args[sizeIndex + 1])),
      );
      return { stdout: "" };
    }
    return { stdout: "" };
  };
  return { executor: macExecutor({ run }), calls };
}

describe("macOS executor key mapping", () => {
  it("maps named, modified, printable, and repeated keys to cliclick commands", () => {
    expect(mapKeyComboToCliclick("cmd+l", 1)).toEqual([
      "kd:cmd",
      "t:l",
      "ku:cmd",
    ]);
    expect(mapKeyComboToCliclick("return", 3)).toEqual([
      "kp:return",
      "kp:return",
      "kp:return",
    ]);
    expect(mapKeyComboToCliclick("cmd+shift+T", 1)).toEqual([
      "kd:cmd,shift",
      "t:t",
      "ku:cmd,shift",
    ]);
    expect(mapKeyComboToCliclick("pageDown", 1)).toEqual(["kp:page-down"]);
    expect(mapKeyComboToCliclick("+", 1)).toEqual(["t:+"]);
  });
});

describe("macOS executor", () => {
  it("captures and resizes screenshots using the screen pixel dimensions", async () => {
    const { executor, calls } = makeExecutor();
    const screenshot = await executor.screenshot();
    await executor.screenshot();
    const target = calculateScreenshotDimensions(3024, 1964);

    expect(target).toEqual({ width: 1280, height: 831 });
    expect(screenshot).toMatchObject({
      mediaType: "image/jpeg",
      width: target.width,
      height: target.height,
    });
    const sips = calls.find((call) => call.file === "sips");
    expect(sips?.args.slice(0, 9)).toEqual([
      "-s",
      "format",
      "jpeg",
      "-s",
      "formatOptions",
      "80",
      "-z",
      "831",
      "1280",
    ]);
    expect(calls.filter((call) =>
      call.file === "osascript" &&
      call.args.some((arg) => arg.includes("AppKit")),
    )).toHaveLength(1);
    expect(calls.filter((call) => call.file === "screencapture")).toHaveLength(2);
  });

  it("maps click coordinates from screenshot pixels to screen points", async () => {
    const { executor, calls } = makeExecutor();
    await executor.screenshot();

    const x = scaleCoordinate(640, 1512, 1280);
    const y = scaleCoordinate(415, 982, 831);
    expect({ x, y }).toEqual({ x: 756, y: 490 });
    expect(
      await executor.execute({
        type: "click",
        x: 640,
        y: 415,
        button: "left",
        clicks: 2,
        modifiers: [],
      }),
    ).toMatchObject({ ok: true });
    expect(calls.filter((call) => call.file === "cliclick").at(-1)?.args)
      .toEqual(["dc:756,490"]);

    await executor.execute({
      type: "click",
      x: 640,
      y: 415,
      button: "right",
      clicks: 1,
      modifiers: ["cmd"],
    });
    expect(calls.filter((call) => call.file === "cliclick").at(-1)?.args)
      .toEqual(["kd:cmd", "rc:756,490", "ku:cmd"]);
  });

  it("rejects middle click without invoking cliclick", async () => {
    const { executor, calls } = makeExecutor();
    expect(
      await executor.execute({
        type: "click",
        x: 1,
        y: 1,
        button: "middle",
        clicks: 1,
        modifiers: [],
      }),
    ).toEqual({
      ok: false,
      error: "Middle click is not supported on macOS.",
    });
    expect(calls).toEqual([]);
  });

  it("types lines as text and return-key commands", async () => {
    const { executor, calls } = makeExecutor();
    await executor.execute({ type: "type", text: "a\nb" });
    expect(calls.filter((call) => call.file === "cliclick").at(-1)?.args)
      .toEqual(["t:a", "kp:return", "t:b"]);
  });

  it("validates app names and opens allowed URLs with argument arrays", async () => {
    const { executor, calls } = makeExecutor();
    expect(await executor.execute({ type: "openApp", name: "-x" })).toEqual({
      ok: false,
      error: "Invalid app name.",
    });
    expect(calls).toEqual([]);

    expect(
      await executor.execute({
        type: "openUrl",
        url: "https://example.com",
      }),
    ).toMatchObject({ ok: true });
    expect(calls.at(-1)).toEqual({
      file: "open",
      args: ["https://example.com"],
    });
  });

  it("moves the pointer before posting scroll wheel lines", async () => {
    const { executor, calls } = makeExecutor();
    await executor.screenshot();
    calls.length = 0;

    await executor.execute({
      type: "scroll",
      x: 10,
      y: 10,
      direction: "down",
      amount: 3,
      modifiers: [],
    });

    expect(calls[0]).toMatchObject({
      file: "cliclick",
      args: [`m:${scaleCoordinate(10, 1512, 1280)},${scaleCoordinate(10, 982, 831)}`],
    });
    expect(calls[1]?.file).toBe("osascript");
    expect(calls[1]?.args.slice(-2)).toEqual(["-3", "0"]);
  });

  it("returns an install hint if cliclick is missing", async () => {
    const { executor } = makeExecutor({ failCliclick: true });

    expect(await executor.execute({ type: "key", keys: "return", repeat: 1 }))
      .toEqual({
        ok: false,
        error: "cliclick is not installed. Run: brew install cliclick",
      });
  });
});
