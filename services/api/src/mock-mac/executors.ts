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
