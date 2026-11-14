import { describe, expect, it } from "vitest";
import { mapToolUse, MAX_SUMMARY_CHARS, type ToolUse } from "../../../../../services/api/src/agent/tools.js";

const screen = { width: 1280, height: 800 };
const computer = (name: string, input: unknown): ToolUse => ({ id: "u", name, input, toolset_name: "computer" });
const custom = (name: string, input: unknown, toolset_name?: string): ToolUse => ({ id: "u", name, input, toolset_name });

describe("mapToolUse input guards", () => {
  it.each([
    [computer("screenshot", "no"), "Tool input must be an object"],
    [computer("screenshot", []), "Tool input must be an object"],
    [computer("screenshot", { extra: 1 }), "Unexpected tool input field: extra"],
    [computer("type", { text: 3 }), "text must be a string"],
    [computer("wait", { duration: "x" }), "duration must be a number"],
    [computer("wait", { duration: Number.NaN }), "duration must be a number"],
    [computer("left_click", { coordinate: [1, 2], text: 3 }), "text modifiers must be a string"],
    [computer("left_click", { coordinate: [1, 2], text: "banana" }), "Unknown modifier: banana"],
    [computer("left_click", { coordinate: "x" }), "coordinate must be an integer [x, y] coordinate"],
    [computer("left_click", { coordinate: [1280, 2] }), "coordinate is outside the latest screenshot"],
    [computer("teleport", {}), "Unknown computer tool: teleport"],
    [custom("screenshot", {}, "other"), "Unknown toolset: other"],
    [custom("mystery", {}), "Unknown custom tool: mystery"],
  ])("%j -> %s", (toolUse, message) => {
    expect(() => mapToolUse(toolUse, screen)).toThrow(message);
  });
});

describe("mapToolUse computer actions", () => {
  it("maps clicks, drags, moves and scrolls", () => {
    expect(mapToolUse(computer("triple_click", { coordinate: [3, 4] }), screen)).toEqual({
      kind: "action",
      action: { type: "click", x: 3, y: 4, button: "left", clicks: 3, modifiers: [] },
    });
    expect(mapToolUse(computer("right_click", { coordinate: [3, 4], text: "shift+cmd" }), screen)).toMatchObject({
      action: { button: "right", modifiers: ["shift", "cmd"] },
    });
    expect(mapToolUse(computer("middle_click", { coordinate: [3, 4] }), screen)).toMatchObject({
      action: { button: "middle" },
    });
    expect(mapToolUse(computer("left_click_drag", { start_coordinate: [1, 2], coordinate: [3, 4], text: "ctrl" }), screen)).toEqual({
      kind: "action",
      action: { type: "drag", fromX: 1, fromY: 2, toX: 3, toY: 4, modifiers: ["ctrl"] },
    });
    expect(mapToolUse(computer("mouse_move", { coordinate: [9, 9] }), screen)).toMatchObject({
      action: { type: "mouseMove", x: 9, y: 9 },
    });
    expect(mapToolUse(computer("scroll", { scroll_direction: "down", scroll_amount: 3 }), screen)).toEqual({
      kind: "action",
      action: { type: "scroll", x: null, y: null, direction: "down", amount: 3, modifiers: [] },
    });
    expect(mapToolUse(computer("scroll", { scroll_direction: "up", scroll_amount: 1, coordinate: [5, 6] }), screen)).toMatchObject({
      action: { x: 5, y: 6 },
    });
  });

  it.each([
    [{ scroll_direction: "sideways", scroll_amount: 1 }, "scroll_direction must be up, down, left, or right"],
    [{ scroll_direction: "down" }, "scroll_amount must be a number"],
  ])("rejects bad scroll input %j", (input, message) => {
    expect(() => mapToolUse(computer("scroll", input), screen)).toThrow(message);
  });

  it("maps type, key and wait", () => {
    expect(mapToolUse(computer("type", { text: "hi" }), screen)).toEqual({
      kind: "action",
      action: { type: "type", text: "hi" },
    });
    expect(mapToolUse(computer("key", { text: "ctrl+alt+delete" }), screen)).toEqual({
      kind: "action",
      action: { type: "key", keys: "ctrl+option+forwardDelete", repeat: 1 },
    });
    expect(mapToolUse(computer("key", { text: "f5", repeat: 2 }), screen)).toMatchObject({
      action: { keys: "f5", repeat: 2 },
    });
    expect(mapToolUse(computer("wait", { duration: 2 }), screen)).toEqual({
      kind: "action",
      action: { type: "wait", seconds: 2 },
    });
    expect(mapToolUse(computer("screenshot", {}), screen)).toEqual({
      kind: "action",
      action: { type: "screenshot" },
    });
  });
});

describe("mapToolUse key normalization", () => {
  it.each([
    ["super+tab", "cmd+tab"],
    ["command+space", "cmd+space"],
    ["meta+q", "cmd+q"],
    ["control+l", "ctrl+l"],
    ["option+left", "option+left"],
    ["shift+f10", "shift+f10"],
    ["cmd+cmd+a", "cmd+a"],
    ["enter", "return"],
    ["A", "A"],
  ])("%s -> %s", (input, keys) => {
    expect(mapToolUse(computer("key", { text: input }), screen)).toMatchObject({ action: { keys } });
  });

  it.each([
    ["cmd++a", "empty key"],
    ["banana+a", "Unknown key modifier"],
    ["cmd+notakey", "Unknown key: notakey"],
  ])("rejects %s", (input, message) => {
    expect(() => mapToolUse(computer("key", { text: input }), screen)).toThrow(message);
  });
});

describe("mapToolUse urls", () => {
  it.each([
    ["example.com", "https://example.com"],
    ["https://a.b/c?d=1", "https://a.b/c?d=1"],
  ])("normalizes %s", (input, url) => {
    expect(mapToolUse(custom("open_url", { url: input }), screen)).toMatchObject({ action: { url } });
  });

  it.each([
    ["  example.com", "no surrounding whitespace"],
    ["nohost", "must look like a hostname"],
    [`https://a.b/${"x".repeat(2100)}`, "at most 2048"],
    ["ftp://example.com", "Only http and https"],
    ["localhost:3000/x", "Only http and https"],
  ])("rejects %j", (input, message) => {
    expect(() => mapToolUse(custom("open_url", { url: input }), screen)).toThrow(message);
  });
});

describe("mapToolUse custom tools", () => {
  it("maps open_app, ask_user and finish", () => {
    expect(mapToolUse(custom("open_app", { name: "Notes" }), screen)).toEqual({
      kind: "action",
      action: { type: "openApp", name: "Notes" },
    });
    expect(mapToolUse(custom("ask_user", { question: "ok?" }), screen)).toEqual({
      kind: "ask_user",
      question: "ok?",
    });
    expect(mapToolUse(custom("finish", { success: true, summary: "done", attach_screenshot: true }), screen)).toEqual({
      kind: "finish",
      success: true,
      summary: "done",
      attachScreenshot: true,
    });
    expect(mapToolUse(custom("finish", { success: false, summary: "x".repeat(2000) }), screen).kind).toBe("finish");
    const finish = mapToolUse(custom("finish", { success: false, summary: "x".repeat(2000) }), screen);
    expect(finish.kind === "finish" && finish.summary).toHaveLength(MAX_SUMMARY_CHARS);
    expect(finish.kind === "finish" && finish.attachScreenshot).toBe(false);
  });

  it.each([
    [{ success: "yes", summary: "s" }, "success must be a boolean"],
    [{ success: true, summary: "s", attach_screenshot: "yes" }, "attach_screenshot must be a boolean"],
    [{ success: true }, "summary must be a string"],
  ])("rejects finish %j", (input, message) => {
    expect(() => mapToolUse(custom("finish", input), screen)).toThrow(message);
  });

  it("rejects an action whose point is outside the screen", () => {
    expect(() => mapToolUse(computer("left_click", { coordinate: [0, 800] }), screen)).toThrow("outside the latest screenshot");
  });
});

describe("mapToolUse remaining guards", () => {
  it("treats an empty modifier chord as no modifiers", () => {
    expect(mapToolUse(computer("left_click", { coordinate: [1, 2], text: "" }), screen)).toMatchObject({
      action: { modifiers: [] },
    });
  });

  it("rejects a URL that parses as garbage after the scheme check", () => {
    expect(() => mapToolUse(custom("open_url", { url: "https://[bad" }), screen)).toThrow("URL is invalid");
  });
});
