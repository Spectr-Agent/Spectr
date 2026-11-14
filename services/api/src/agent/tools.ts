import { MacActionSchema, type MacAction } from "../contracts.js";

export const ANTHROPIC_TOOLS = [
  {
    type: "computer_toolset_20260801",
    configs: {
      zoom: { enabled: false },
      left_mouse_down: { enabled: false },
      left_mouse_up: { enabled: false },
      cursor_position: { enabled: false },
      hold_key: { enabled: false },
    },
  },
  {
    name: "open_app",
    description: "Open or switch to the app with this exact name.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
      additionalProperties: false,
    },
  },
  {
    name: "open_url",
    description: "Open the requested website URL.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string" } },
      required: ["url"],
      additionalProperties: false,
    },
  },
  {
    name: "ask_user",
    description: "Ask the user a short question or request confirmation.",
    input_schema: {
      type: "object",
      properties: { question: { type: "string" } },
      required: ["question"],
      additionalProperties: false,
    },
  },
  {
    name: "finish",
    description: "Report whether the requested state is visible on screen.",
    input_schema: {
      type: "object",
      properties: {
        success: { type: "boolean" },
        summary: { type: "string" },
      },
      required: ["success", "summary"],
      additionalProperties: false,
    },
  },
] as const;

export type ToolUse = {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
  toolset_name?: string;
};

export type MappedTool =
  | { kind: "action"; action: MacAction }
  | { kind: "ask_user"; question: string }
  | { kind: "finish"; success: boolean; summary: string };

type MacModifier = "cmd" | "option" | "ctrl" | "shift";

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Tool input must be an object");
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  input: Record<string, unknown>,
  allowed: readonly string[],
): void {
  const unexpected = Object.keys(input).find((key) => !allowed.includes(key));
  if (unexpected) {
    throw new Error(`Unexpected tool input field: ${unexpected}`);
  }
}

function requiredString(
  input: Record<string, unknown>,
  key: string,
): string {
  const value = input[key];
  if (typeof value !== "string") {
    throw new Error(`${key} must be a string`);
  }
  return value;
}

function requiredNumber(
  input: Record<string, unknown>,
  key: string,
): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${key} must be a number`);
  }
  return value;
}

function normalizeModifiers(value: unknown): MacModifier[] {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== "string") {
    throw new Error("text modifiers must be a string");
  }
  if (value === "") {
    return [];
  }
  const modifiers: MacModifier[] = [];
  for (const modifier of value.split("+")) {
    const normalized = modifier.toLowerCase();
    const mapped =
      normalized === "super" ||
      normalized === "cmd" ||
      normalized === "command" ||
      normalized === "meta"
        ? "cmd"
        : normalized === "alt" || normalized === "option"
          ? "option"
          : normalized === "ctrl" || normalized === "control"
            ? "ctrl"
            : normalized === "shift"
              ? "shift"
        : null;
    if (!mapped) {
      throw new Error(`Unknown modifier: ${modifier}`);
    }
    if (!modifiers.includes(mapped)) {
      modifiers.push(mapped);
    }
  }
  return modifiers;
}

function coordinate(
  value: unknown,
  name: string,
  width: number,
  height: number,
): [number, number] {
  if (
    !Array.isArray(value) ||
    value.length !== 2 ||
    !Number.isInteger(value[0]) ||
    !Number.isInteger(value[1])
  ) {
    throw new Error(`${name} must be an integer [x, y] coordinate`);
  }
  const [x, y] = value as [number, number];
  if (x < 0 || x >= width || y < 0 || y >= height) {
    throw new Error(`${name} is outside the latest screenshot`);
  }
  return [x, y];
}

function normalizedUrl(value: string): string {
  if (value.length === 0 || value !== value.trim()) {
    throw new Error("URL must be non-empty and have no surrounding whitespace");
  }
  let normalized = value;
  if (!/^[a-z][a-z\d+.-]*:/iu.test(value)) {
    const hostname = value.split(/[/?#]/u, 1)[0] ?? "";
    if (!/^(?:localhost|(?:[a-z\d-]+\.)+[a-z]{2,})(?::\d+)?$/iu.test(hostname)) {
      throw new Error("URL without a scheme must look like a hostname");
    }
    normalized = `https://${value}`;
  }
  if (normalized.length > 2048) {
    throw new Error("URL must be at most 2048 characters");
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("URL is invalid");
  }
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !url.hostname
  ) {
    throw new Error("Only http and https URLs are allowed");
  }
  return normalized;
}

const keyNameMap: Record<string, string> = {
  return: "return",
  enter: "return",
  tab: "tab",
  escape: "escape",
  esc: "escape",
  space: "space",
  backspace: "delete",
  delete: "forwardDelete",
  up: "up",
  down: "down",
  left: "left",
  right: "right",
  home: "home",
  end: "end",
  page_up: "pageUp",
  pageup: "pageUp",
  page_down: "pageDown",
  pagedown: "pageDown",
};

function normalizeKey(text: string): string {
  if (text === "+") {
    return text;
  }
  const parts = text.split("+");
  if (parts.some((part) => part.length === 0)) {
    throw new Error("Key combo contains an empty key");
  }
  const rawKey = parts.pop()!;
  const modifiers: string[] = [];
  for (const modifier of parts) {
    const normalized = modifier.toLowerCase();
    const mapped =
      normalized === "super" ||
      normalized === "cmd" ||
      normalized === "command" ||
      normalized === "meta"
        ? "cmd"
        : normalized === "alt" || normalized === "option"
          ? "option"
          : normalized === "ctrl" || normalized === "control"
            ? "ctrl"
            : normalized === "shift"
              ? "shift"
              : null;
    if (!mapped) {
      throw new Error(`Unknown key modifier: ${modifier}`);
    }
    if (!modifiers.includes(mapped)) {
      modifiers.push(mapped);
    }
  }

  const lowerKey = rawKey.toLowerCase();
  let key = keyNameMap[lowerKey];
  if (!key && /^f(?:[1-9]|1[0-2])$/iu.test(rawKey)) {
    key = lowerKey;
  }
  if (!key && [...rawKey].length === 1 && !/[\p{Cc}\p{Cf}]/u.test(rawKey)) {
    key = rawKey;
  }
  if (!key) {
    throw new Error(`Unknown key: ${rawKey}`);
  }
  return [...modifiers, key].join("+");
}

function validateMacAction(
  action: unknown,
  width: number,
  height: number,
): MacAction {
  const parsed = MacActionSchema.safeParse(action);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid Mac action");
  }
  const result = parsed.data;
  const points: Array<[number, number]> = [];
  if (result.type === "click" || result.type === "mouseMove") {
    points.push([result.x, result.y]);
  } else if (result.type === "drag") {
    points.push(
      [result.fromX, result.fromY],
      [result.toX, result.toY],
    );
  } else if (result.type === "scroll") {
    if (result.x !== null && result.y !== null) {
      points.push([result.x, result.y]);
    } else if (result.x !== null || result.y !== null) {
      throw new Error("Scroll coordinates must both be null or both be set");
    }
  }
  if (
    points.some(
      ([x, y]) => x >= width || y >= height,
    )
  ) {
    throw new Error("Coordinate is outside the latest screenshot");
  }
  return result;
}

export function mapToolUse(
  toolUse: ToolUse,
  screen: { width: number; height: number },
): MappedTool {
  const input = asRecord(toolUse.input);
  if (toolUse.toolset_name === "computer") {
    let action: unknown;
    switch (toolUse.name) {
      case "screenshot":
        exactKeys(input, []);
        action = { type: "screenshot" };
        break;
      case "left_click":
      case "right_click":
      case "middle_click":
      case "double_click":
      case "triple_click": {
        exactKeys(input, ["coordinate", "text"]);
        const [x, y] = coordinate(
          input.coordinate,
          "coordinate",
          screen.width,
          screen.height,
        );
        const clicks =
          toolUse.name === "double_click"
            ? 2
            : toolUse.name === "triple_click"
              ? 3
              : 1;
        const button =
          toolUse.name === "right_click"
            ? "right"
            : toolUse.name === "middle_click"
              ? "middle"
              : "left";
        action = {
          type: "click",
          x,
          y,
          button,
          clicks,
          modifiers: normalizeModifiers(input.text),
        };
        break;
      }
      case "left_click_drag": {
        exactKeys(input, ["start_coordinate", "coordinate", "text"]);
        const [fromX, fromY] = coordinate(
          input.start_coordinate,
          "start_coordinate",
          screen.width,
          screen.height,
        );
        const [toX, toY] = coordinate(
          input.coordinate,
          "coordinate",
          screen.width,
          screen.height,
        );
        action = {
          type: "drag",
          fromX,
          fromY,
          toX,
          toY,
          modifiers: normalizeModifiers(input.text),
        };
        break;
      }
      case "mouse_move": {
        exactKeys(input, ["coordinate"]);
        const [x, y] = coordinate(
          input.coordinate,
          "coordinate",
          screen.width,
          screen.height,
        );
        action = { type: "mouseMove", x, y };
        break;
      }
      case "scroll": {
        exactKeys(input, [
          "scroll_direction",
          "scroll_amount",
          "coordinate",
          "text",
        ]);
        const direction = requiredString(input, "scroll_direction");
        if (!["up", "down", "left", "right"].includes(direction)) {
          throw new Error("scroll_direction must be up, down, left, or right");
        }
        const amount = requiredNumber(input, "scroll_amount");
        let x: number | null = null;
        let y: number | null = null;
        if (input.coordinate !== undefined) {
          [x, y] = coordinate(
            input.coordinate,
            "coordinate",
            screen.width,
            screen.height,
          );
        }
        action = {
          type: "scroll",
          x,
          y,
          direction,
          amount,
          modifiers: normalizeModifiers(input.text),
        };
        break;
      }
      case "type":
        exactKeys(input, ["text"]);
        action = { type: "type", text: requiredString(input, "text") };
        break;
      case "key":
        exactKeys(input, ["text", "repeat"]);
        action = {
          type: "key",
          keys: normalizeKey(requiredString(input, "text")),
          repeat: input.repeat === undefined ? 1 : input.repeat,
        };
        break;
      case "wait":
        exactKeys(input, ["duration"]);
        action = { type: "wait", seconds: requiredNumber(input, "duration") };
        break;
      default:
        throw new Error(`Unknown computer tool: ${toolUse.name}`);
    }
    return {
      kind: "action",
      action: validateMacAction(action, screen.width, screen.height),
    };
  }

  if (toolUse.toolset_name !== undefined) {
    throw new Error(`Unknown toolset: ${toolUse.toolset_name}`);
  }
  switch (toolUse.name) {
    case "open_app":
      exactKeys(input, ["name"]);
      return {
        kind: "action",
        action: validateMacAction(
          { type: "openApp", name: requiredString(input, "name") },
          screen.width,
          screen.height,
        ),
      };
    case "open_url":
      exactKeys(input, ["url"]);
      return {
        kind: "action",
        action: validateMacAction(
          {
            type: "openUrl",
            url: normalizedUrl(requiredString(input, "url")),
          },
          screen.width,
          screen.height,
        ),
      };
    case "ask_user":
      exactKeys(input, ["question"]);
      return { kind: "ask_user", question: requiredString(input, "question") };
    case "finish":
      exactKeys(input, ["success", "summary"]);
      if (typeof input.success !== "boolean") {
        throw new Error("success must be a boolean");
      }
      return {
        kind: "finish",
        success: input.success,
        summary: requiredString(input, "summary").slice(0, 300),
      };
    default:
      throw new Error(`Unknown custom tool: ${toolUse.name}`);
  }
}
