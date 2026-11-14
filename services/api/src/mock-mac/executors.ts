import { randomUUID } from "node:crypto";
import {
  execFile as execFileCallback,
  type ExecFileOptions,
} from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import type { MacAction } from "../contracts.js";

export interface MockMacScreenshot {
  mediaType: "image/png" | "image/jpeg";
  data: string;
  width: number;
  height: number;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  output?: string;
}

export interface MockMacExecutor {
  screenshot(): Promise<MockMacScreenshot>;
  execute(action: MacAction): Promise<ActionResult>;
}

const execFile = promisify(execFileCallback);
const MAX_IMAGE_EDGE = 1280;
const MAX_IMAGE_TOKENS = 4784;

function imageDimensions(bytes: Buffer): {
  mediaType: MockMacScreenshot["mediaType"];
  width: number;
  height: number;
} {
  if (
    bytes.length >= 24 &&
    bytes.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return {
      mediaType: "image/png",
      width: bytes.readUInt32BE(16),
      height: bytes.readUInt32BE(20),
    };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (bytes[offset] === 0xff) {
        offset += 1;
      }
      const marker = bytes[offset];
      offset += 1;
      if (marker === 0xd8 || marker === 0xd9) {
        continue;
      }
      if (offset + 2 > bytes.length) {
        break;
      }
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) {
        break;
      }
      if (
        marker !== undefined &&
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)
      ) {
        return {
          mediaType: "image/jpeg",
          height: bytes.readUInt16BE(offset + 3),
          width: bytes.readUInt16BE(offset + 5),
        };
      }
      offset += segmentLength;
    }
  }
  throw new Error("Screenshot must be a PNG or JPEG image with readable dimensions.");
}

export function calculateScreenshotDimensions(
  width: number,
  height: number,
): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("Screenshot dimensions must be positive integers.");
  }
  const maximumScale = Math.min(1, MAX_IMAGE_EDGE / Math.max(width, height));
  const fits = (scale: number) => {
    const scaledWidth = Math.max(1, Math.floor(width * scale));
    const scaledHeight = Math.max(1, Math.floor(height * scale));
    return (
      Math.max(scaledWidth, scaledHeight) <= MAX_IMAGE_EDGE &&
      Math.ceil(scaledWidth / 28) * Math.ceil(scaledHeight / 28) <=
        MAX_IMAGE_TOKENS
    );
  };
  if (fits(maximumScale)) {
    return {
      width: Math.max(1, Math.floor(width * maximumScale)),
      height: Math.max(1, Math.floor(height * maximumScale)),
    };
  }
  let low = 0;
  let high = maximumScale;
  for (let attempt = 0; attempt < 48; attempt += 1) {
    const middle = (low + high) / 2;
    if (fits(middle)) {
      low = middle;
    } else {
      high = middle;
    }
  }
  return {
    width: Math.max(1, Math.floor(width * low)),
    height: Math.max(1, Math.floor(height * low)),
  };
}

export function scaleCoordinate(
  coordinate: number,
  originalSize: number,
  resizedSize: number,
): number {
  return Math.max(
    0,
    Math.min(
      originalSize - 1,
      Math.round((coordinate * originalSize) / resizedSize),
    ),
  );
}

const specialKeysyms: Record<string, string> = {
  return: "Return",
  tab: "Tab",
  escape: "Escape",
  space: "space",
  delete: "BackSpace",
  forwardDelete: "Delete",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  home: "Home",
  end: "End",
  pageUp: "Prior",
  pageDown: "Next",
  "+": "plus",
  "-": "minus",
  "=": "equal",
  "/": "slash",
  "\\": "backslash",
  ".": "period",
  ",": "comma",
  ";": "semicolon",
  "'": "apostrophe",
  "\"": "quotedbl",
  "`": "grave",
  "~": "asciitilde",
  "!": "exclam",
  "@": "at",
  "#": "numbersign",
  "$": "dollar",
  "%": "percent",
  "^": "asciicircum",
  "&": "ampersand",
  "*": "asterisk",
  "(": "parenleft",
  ")": "parenright",
  "_": "underscore",
  ":": "colon",
  "<": "less",
  ">": "greater",
  "?": "question",
  "[": "bracketleft",
  "]": "bracketright",
  "{": "braceleft",
  "}": "braceright",
  "|": "bar",
};

const xdotoolModifiers: Record<string, string> = {
  cmd: "ctrl",
  option: "alt",
  ctrl: "ctrl",
  shift: "shift",
};

function xdotoolKeysym(key: string): string {
  return (
    specialKeysyms[key] ??
    (/^f(?:[1-9]|1[0-2])$/u.test(key)
      ? key.toUpperCase()
      : key)
  );
}

export function mapKeyComboToXdotool(
  combo: string,
  repeat = 1,
): string[] {
  const parts = combo === "+" ? ["+"] : combo.split("+");
  const key = parts.pop() ?? "";
  const modifiers = parts.map((modifier) => xdotoolModifiers[modifier] ?? modifier);
  const keysym = xdotoolKeysym(key);
  const chord = [...new Set(modifiers), keysym].join("+");
  return ["key", "--repeat", String(repeat), chord];
}

function xdotoolButton(button: "left" | "middle" | "right"): string {
  return button === "left" ? "1" : button === "middle" ? "2" : "3";
}

function modifierKeys(modifiers: readonly string[]): string[] {
  return [...new Set(modifiers.map((modifier) => xdotoolModifiers[modifier] ?? modifier))]
    .map((modifier) => modifier === "ctrl"
      ? "Control_L"
      : modifier === "alt"
        ? "Alt_L"
        : modifier === "shift"
          ? "Shift_L"
          : modifier);
}

function mappedCoordinate(
  coordinate: number,
  originalSize: number,
  resizedSize: number,
): number {
  return scaleCoordinate(coordinate, originalSize, resizedSize);
}

function launchDetached(
  command: string,
  args: string[],
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFileCallback(
      command,
      args,
      { detached: true, stdio: "ignore" } as ExecFileOptions & {
        detached: true;
        stdio: "ignore";
      },
      (error) => {
        if (error) {
          reject(error);
        }
      },
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
    child.once("error", reject);
  });
}

export function fixtureExecutor(options: {
  screenshotPath: string;
  onAction?: (action: MacAction) => void;
}): MockMacExecutor & { actions: MacAction[] } {
  let cachedScreenshot: MockMacScreenshot | undefined;
  const actions: MacAction[] = [];
  return {
    actions,
    async screenshot() {
      if (!cachedScreenshot) {
        const bytes = await readFile(options.screenshotPath);
        const dimensions = imageDimensions(bytes);
        cachedScreenshot = {
          ...dimensions,
          data: bytes.toString("base64"),
        };
      }
      return cachedScreenshot;
    },
    async execute(action) {
      actions.push(action);
      options.onAction?.(action);
      return { ok: true, output: "OK" };
    },
  };
}

export function desktopExecutor(): MockMacExecutor {
  let scale:
    | {
        originalWidth: number;
        originalHeight: number;
        resizedWidth: number;
        resizedHeight: number;
      }
    | undefined;

  return {
    async screenshot() {
      const directory = await mkdtemp(join(tmpdir(), "spectr-mock-mac-"));
      const pngPath = join(directory, `${randomUUID()}.png`);
      const jpegPath = join(directory, `${randomUUID()}.jpg`);
      try {
        await execFile("scrot", ["-o", pngPath]);
        const { stdout: dimensionsText } = await execFile("identify", [
          "-format",
          "%w %h",
          pngPath,
        ]);
        const [widthText, heightText] = String(dimensionsText).split(" ");
        const originalWidth = Number(widthText);
        const originalHeight = Number(heightText);
        const resized = calculateScreenshotDimensions(
          originalWidth,
          originalHeight,
        );
        await execFile("convert", [
          pngPath,
          "-resize",
          `${resized.width}x${resized.height}!`,
          "-quality",
          "80",
          jpegPath,
        ]);
        const bytes = await readFile(jpegPath);
        scale = {
          originalWidth,
          originalHeight,
          resizedWidth: resized.width,
          resizedHeight: resized.height,
        };
        return {
          mediaType: "image/jpeg" as const,
          data: bytes.toString("base64"),
          width: resized.width,
          height: resized.height,
        };
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    async execute(action) {
      try {
        if (action.type === "wait") {
          await new Promise((resolve) =>
            setTimeout(resolve, action.seconds * 1000),
          );
          return { ok: true, output: "OK" };
        }
        if (action.type === "screenshot") {
          return { ok: true, output: "OK" };
        }
        const browser = process.env.MOCK_MAC_BROWSER ?? "google-chrome";
        if (action.type === "openUrl") {
          await launchDetached(browser, [action.url]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "openApp") {
          const app = action.name.trim().toLowerCase();
          if (
            !["google chrome", "chrome", "safari", "firefox"].includes(app)
          ) {
            return {
              ok: false,
              error: `App not available on this mock Mac: ${action.name}`,
            };
          }
          await launchDetached(browser, []);
          return { ok: true, output: "OK" };
        }
        if (!scale) {
          return { ok: false, error: "Take a screenshot before executing actions." };
        }
        if (action.type === "mouseMove") {
          await execFile("xdotool", [
            "mousemove",
            String(mappedCoordinate(action.x, scale.originalWidth, scale.resizedWidth)),
            String(mappedCoordinate(action.y, scale.originalHeight, scale.resizedHeight)),
          ]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "click") {
          const x = mappedCoordinate(action.x, scale.originalWidth, scale.resizedWidth);
          const y = mappedCoordinate(action.y, scale.originalHeight, scale.resizedHeight);
          const pressed = modifierKeys(action.modifiers);
          await execFile("xdotool", ["mousemove", String(x), String(y)]);
          try {
            for (const key of pressed) {
              await execFile("xdotool", ["keydown", key]);
            }
            await execFile("xdotool", [
              "click",
              "--repeat",
              String(action.clicks),
              xdotoolButton(action.button),
            ]);
          } finally {
            for (const key of [...pressed].reverse()) {
              await execFile("xdotool", ["keyup", key]);
            }
          }
          return { ok: true, output: "OK" };
        }
        if (action.type === "drag") {
          const fromX = mappedCoordinate(action.fromX, scale.originalWidth, scale.resizedWidth);
          const fromY = mappedCoordinate(action.fromY, scale.originalHeight, scale.resizedHeight);
          const toX = mappedCoordinate(action.toX, scale.originalWidth, scale.resizedWidth);
          const toY = mappedCoordinate(action.toY, scale.originalHeight, scale.resizedHeight);
          const pressed = modifierKeys(action.modifiers);
          try {
            for (const key of pressed) {
              await execFile("xdotool", ["keydown", key]);
            }
            await execFile("xdotool", ["mousemove", String(fromX), String(fromY)]);
            await execFile("xdotool", ["mousedown", "1"]);
            await execFile("xdotool", ["mousemove", String(toX), String(toY)]);
            await execFile("xdotool", ["mouseup", "1"]);
          } finally {
            for (const key of [...pressed].reverse()) {
              await execFile("xdotool", ["keyup", key]);
            }
          }
          return { ok: true, output: "OK" };
        }
        if (action.type === "scroll") {
          if (action.x !== null && action.y !== null) {
            await execFile("xdotool", [
              "mousemove",
              String(mappedCoordinate(action.x, scale.originalWidth, scale.resizedWidth)),
              String(mappedCoordinate(action.y, scale.originalHeight, scale.resizedHeight)),
            ]);
          }
          const pressed = modifierKeys(action.modifiers);
          const button = {
            up: "4",
            down: "5",
            left: "6",
            right: "7",
          }[action.direction];
          try {
            for (const key of pressed) {
              await execFile("xdotool", ["keydown", key]);
            }
            await execFile("xdotool", [
              "click",
              "--repeat",
              String(action.amount),
              button,
            ]);
          } finally {
            for (const key of [...pressed].reverse()) {
              await execFile("xdotool", ["keyup", key]);
            }
          }
          return { ok: true, output: "OK" };
        }
        if (action.type === "type") {
          await execFile("xdotool", [
            "type",
            "--delay",
            "12",
            "--",
            action.text,
          ]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "key") {
          await execFile(
            "xdotool",
            mapKeyComboToXdotool(action.keys, action.repeat),
          );
          return { ok: true, output: "OK" };
        }
        return { ok: false, error: "Unsupported mock Mac action." };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Mock Mac action failed.",
        };
      }
    },
  };
}

export type RunCommand = (
  file: string,
  args: string[],
) => Promise<{ stdout: string }>;

type ScreenSize = { width: number; height: number };

const cliclickModifiers: Record<string, string> = {
  cmd: "cmd",
  option: "alt",
  ctrl: "ctrl",
  shift: "shift",
};

const cliclickKeys: Record<string, string> = {
  return: "return",
  tab: "tab",
  escape: "esc",
  space: "space",
  delete: "delete",
  forwardDelete: "fwd-delete",
  up: "arrow-up",
  down: "arrow-down",
  left: "arrow-left",
  right: "arrow-right",
  home: "home",
  end: "end",
  pageUp: "page-up",
  pageDown: "page-down",
};

function isModifier(value: string): boolean {
  return value in cliclickModifiers;
}

export function mapKeyComboToCliclick(
  combo: string,
  repeat = 1,
): string[] {
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error("Key repeat must be a positive integer.");
  }
  const parts = combo === "+" ? ["+"] : combo.split("+");
  const modifiers: string[] = [];
  while (parts.length > 1 && isModifier(parts[0] ?? "")) {
    modifiers.push(cliclickModifiers[parts.shift()!]!);
  }
  const key = parts.join("+");
  let command: string;
  if (key in cliclickKeys) {
    command = `kp:${cliclickKeys[key]}`;
  } else if (/^f(?:[1-9]|1[0-2])$/iu.test(key)) {
    command = `kp:${key.toLowerCase()}`;
  } else if (key.length === 1) {
    command = `t:${modifiers.length > 0 ? key.toLowerCase() : key}`;
  } else {
    throw new Error("Unsupported Mac key.");
  }

  const commands: string[] = [];
  const modifierList = [...new Set(modifiers)].join(",");
  for (let index = 0; index < repeat; index += 1) {
    if (modifierList) {
      commands.push(`kd:${modifierList}`);
    }
    commands.push(command);
    if (modifierList) {
      commands.push(`ku:${modifierList}`);
    }
  }
  return commands;
}

const macScreenSizeScript =
  'ObjC.import("AppKit"); var f=$.NSScreen.mainScreen.frame; f.size.width+"x"+f.size.height';

const macScrollScript =
  'function run(argv){ObjC.import("CoreGraphics"); var e=$.CGEventCreateScrollWheelEvent2(null, 1, 2, Number(argv[0]), Number(argv[1]), 0); $.CGEventPost(0, e); return "ok";}';

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function macExecutor(options?: {
  run?: RunCommand;
  sleep?: (milliseconds: number) => Promise<void>;
}): MockMacExecutor {
  const run: RunCommand =
    options?.run ??
    (async (file, args) => {
      const result = await execFile(file, args);
      return { stdout: String(result.stdout) };
    });
  const sleep =
    options?.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let screenSizePromise: Promise<ScreenSize> | undefined;
  let lastScreenshotSize: ScreenSize | undefined;

  const getScreenSize = (): Promise<ScreenSize> => {
    screenSizePromise ??= (async () => {
      const { stdout } = await run("osascript", [
        "-l",
        "JavaScript",
        "-e",
        macScreenSizeScript,
      ]);
      const match = stdout.trim().match(/^(\d+)x(\d+)$/u);
      if (!match) {
        throw new Error("Could not determine the Mac screen size.");
      }
      const width = Number(match[1]);
      const height = Number(match[2]);
      if (width < 1 || height < 1) {
        throw new Error("Could not determine the Mac screen size.");
      }
      return { width, height };
    })();
    return screenSizePromise;
  };

  const runCliclick = async (args: string[]): Promise<void> => {
    try {
      await run("cliclick", args);
    } catch (error) {
      if (isMissingExecutable(error)) {
        throw new Error("cliclick is not installed. Run: brew install cliclick");
      }
      throw error;
    }
  };

  const captureScreenshot = async (): Promise<MockMacScreenshot> => {
    await getScreenSize();
    const directory = await mkdtemp(join(tmpdir(), "spectr-mac-executor-"));
    const rawPath = join(directory, "raw.png");
    const screenshotPath = join(directory, "shot.jpg");
    try {
      let rawBytes: Buffer;
      try {
        await run("screencapture", ["-x", "-t", "png", rawPath]);
        rawBytes = await readFile(rawPath);
      } catch {
        throw new Error(
          "Screen capture failed. Grant the Terminal app access in System Settings → Privacy & Security → Screen Recording.",
        );
      }
      const rawSize = imageDimensions(rawBytes);
      const targetSize = calculateScreenshotDimensions(
        rawSize.width,
        rawSize.height,
      );
      await run("sips", [
        "-s",
        "format",
        "jpeg",
        "-s",
        "formatOptions",
        "80",
        "-z",
        String(targetSize.height),
        String(targetSize.width),
        rawPath,
        "--out",
        screenshotPath,
      ]);
      const screenshotBytes = await readFile(screenshotPath);
      imageDimensions(screenshotBytes);
      lastScreenshotSize = targetSize;
      return {
        mediaType: "image/jpeg",
        data: screenshotBytes.toString("base64"),
        width: targetSize.width,
        height: targetSize.height,
      };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  };

  const ensureScreenshot = async (): Promise<ScreenSize> => {
    if (!lastScreenshotSize) {
      await captureScreenshot();
    }
    if (!lastScreenshotSize) {
      throw new Error("Could not capture the Mac screen.");
    }
    return lastScreenshotSize;
  };

  const point = async (
    x: number,
    y: number,
  ): Promise<{ x: number; y: number }> => {
    const screenshotSize = await ensureScreenshot();
    const screenSize = await getScreenSize();
    return {
      x: scaleCoordinate(x, screenSize.width, screenshotSize.width),
      y: scaleCoordinate(y, screenSize.height, screenshotSize.height),
    };
  };

  const executor: MockMacExecutor = {
    screenshot: captureScreenshot,
    async execute(action) {
      try {
        if (action.type === "wait") {
          await sleep(action.seconds * 1000);
          return { ok: true, output: "OK" };
        }
        if (action.type === "screenshot") {
          return { ok: true, output: "OK" };
        }
        if (action.type === "openUrl") {
          if (
            action.url.startsWith("-") ||
            (!action.url.startsWith("http://") &&
              !action.url.startsWith("https://"))
          ) {
            return { ok: false, error: "Only HTTP and HTTPS URLs can be opened." };
          }
          await run("open", [action.url]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "openApp") {
          if (
            action.name.startsWith("-") ||
            action.name.includes("/") ||
            /[\u0000-\u001f\u007f]/u.test(action.name)
          ) {
            return { ok: false, error: "Invalid app name." };
          }
          try {
            await run("open", ["-a", action.name]);
          } catch {
            return { ok: false, error: `Couldn't open app ${action.name}.` };
          }
          return { ok: true, output: "OK" };
        }
        if (action.type === "type") {
          await ensureScreenshot();
          const commands = action.text.split("\n").flatMap((line, index) => [
            ...(index > 0 ? ["kp:return"] : []),
            ...(line.length > 0 ? [`t:${line}`] : []),
          ]);
          if (commands.length > 0) {
            await runCliclick(commands);
          }
          return { ok: true, output: "OK" };
        }
        if (action.type === "key") {
          await ensureScreenshot();
          await runCliclick(mapKeyComboToCliclick(action.keys, action.repeat));
          return { ok: true, output: "OK" };
        }
        if (action.type === "click" && action.button === "middle") {
          return {
            ok: false,
            error: "Middle click is not supported on macOS.",
          };
        }
        if (
          action.type === "click" &&
          action.button === "right" &&
          action.clicks > 1
        ) {
          return {
            ok: false,
            error: "right click supports one click",
          };
        }
        if (action.type === "mouseMove") {
          const coordinate = await point(action.x, action.y);
          await runCliclick([`m:${coordinate.x},${coordinate.y}`]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "click") {
          const coordinate = await point(action.x, action.y);
          const modifiers = action.modifiers
            .map((modifier) => cliclickModifiers[modifier])
            .join(",");
          const clickCommand =
            action.button === "right"
              ? `rc:${coordinate.x},${coordinate.y}`
              : action.clicks === 1
                ? `c:${coordinate.x},${coordinate.y}`
                : action.clicks === 2
                  ? `dc:${coordinate.x},${coordinate.y}`
                  : `tc:${coordinate.x},${coordinate.y}`;
          await runCliclick([
            ...(modifiers ? [`kd:${modifiers}`] : []),
            clickCommand,
            ...(modifiers ? [`ku:${modifiers}`] : []),
          ]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "drag") {
          const from = await point(action.fromX, action.fromY);
          const to = await point(action.toX, action.toY);
          const modifiers = action.modifiers
            .map((modifier) => cliclickModifiers[modifier])
            .join(",");
          await runCliclick([
            "-w",
            "50",
            ...(modifiers ? [`kd:${modifiers}`] : []),
            `dd:${from.x},${from.y}`,
            `m:${to.x},${to.y}`,
            `du:${to.x},${to.y}`,
            ...(modifiers ? [`ku:${modifiers}`] : []),
          ]);
          return { ok: true, output: "OK" };
        }
        if (action.type === "scroll") {
          await ensureScreenshot();
          if (action.x !== null && action.y !== null) {
            const coordinate = await point(action.x, action.y);
            await runCliclick([`m:${coordinate.x},${coordinate.y}`]);
          }
          const modifiers = action.modifiers
            .map((modifier) => cliclickModifiers[modifier])
            .join(",");
          if (modifiers) {
            await runCliclick([`kd:${modifiers}`]);
          }
          const dy =
            action.direction === "down"
              ? -action.amount
              : action.direction === "up"
                ? action.amount
                : 0;
          const dx =
            action.direction === "right"
              ? -action.amount
              : action.direction === "left"
                ? action.amount
                : 0;
          try {
            await run("osascript", [
              "-l",
              "JavaScript",
              "-e",
              macScrollScript,
              String(dy),
              String(dx),
            ]);
          } finally {
            if (modifiers) {
              await runCliclick([`ku:${modifiers}`]);
            }
          }
          return { ok: true, output: "OK" };
        }
        return { ok: false, error: "Unsupported Mac action." };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : "Mac action failed.",
        };
      }
    },
  };

  return executor;
}
