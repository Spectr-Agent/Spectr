import { describe, expect, it } from "vitest";
import type { MacAction } from "../../../../../services/api/src/contracts.js";
import {
  activityFor,
  describeAction,
  isApprovalQuestion,
  macView,
  taskView,
} from "../../../../../services/api/src/app/views.js";

const action = (over: object) => over as MacAction;

describe("isApprovalQuestion", () => {
  it.each([
    [null, false],
    ["hello", false],
    ["Send the message?", true],
    ["What time is it?", false],
    ["Should I buy it?", true],
    ["  Submit the form?  ", true],
  ])("%j -> %s", (question, expected) => {
    expect(isApprovalQuestion(question)).toBe(expected);
  });
});

describe("describeAction", () => {
  it.each([
    [{ type: "openApp", name: "Notes" }, "Opening Notes"],
    [{ type: "openUrl", url: "https://www.example.com/x" }, "Opening example.com"],
    [{ type: "openUrl", url: "not a url" }, "Opening a website"],
    [{ type: "type", text: "milk" }, "Typing “milk”"],
    [{ type: "key", keys: "return" }, "Pressing Return"],
    [{ type: "key", keys: "Enter" }, "Pressing Return"],
    [{ type: "key", keys: "cmd+tab" }, "Pressing cmd+tab"],
    [{ type: "click", clicks: 1, button: "left" }, "Clicking"],
    [{ type: "click", clicks: 2, button: "left" }, "Double-clicking"],
    [{ type: "click", clicks: 1, button: "right" }, "Right-clicking"],
    [{ type: "drag" }, "Dragging"],
    [{ type: "scroll", direction: "down" }, "Scrolling down"],
    [{ type: "wait" }, "Waiting for the screen"],
    [{ type: "mouseMove" }, null],
    [{ type: "screenshot" }, null],
  ])("%j -> %j", (a, expected) => {
    expect(describeAction(action(a))).toBe(expected);
  });

  it("clips long typed text", () => {
    const text = describeAction(action({ type: "type", text: "x".repeat(100) }))!;
    expect(text).toContain("…");
    expect(text.length).toBeLessThan(60);
  });
});

describe("activityFor", () => {
  const row = (over: object) => over as never;

  it("maps accepted to Starting, other non-running to null", () => {
    expect(activityFor(row({ state: "accepted" }))).toBe("Starting");
    expect(activityFor(row({ state: "waitingForUser" }))).toBeNull();
  });

  it("prefers Opening or Typing inside the step's actions", () => {
    const step = {
      kind: "actions",
      actions: [
        { action: { type: "click", clicks: 1, button: "left" } },
        { action: { type: "type", text: "hi" } },
      ],
    };
    expect(activityFor(row({ state: "running", last_step_response: step, step_count: 3 }))).toMatch(/^Typing/u);
    const clicksOnly = { kind: "actions", actions: [{ action: { type: "click", clicks: 1, button: "left" } }] };
    expect(activityFor(row({ state: "running", last_step_response: clicksOnly, step_count: 1 }))).toBe("Clicking");
    const empty = { kind: "actions", actions: [{ action: { type: "screenshot" } }] };
    expect(activityFor(row({ state: "running", last_step_response: empty, step_count: 1 }))).toBe("Looking at the screen");
  });

  it("handles missing or malformed step responses", () => {
    expect(activityFor(row({ state: "running", last_step_response: null, step_count: 0 }))).toBe("Looking at the screen");
    expect(activityFor(row({ state: "running", last_step_response: null, step_count: 2 }))).toBe("Thinking");
    expect(activityFor(row({ state: "running", last_step_response: "{bad", step_count: 2 }))).toBe("Thinking");
    expect(activityFor(row({ state: "running", last_step_response: JSON.stringify({ kind: "waiting" }), step_count: 1 }))).toBe("Thinking");
  });
});

describe("taskView", () => {
  const row = {
    id: "tsk_1",
    device_id: "mac-1",
    state: "waitingForUser",
    revision: 2,
    instruction: "do",
    question: "Send it?",
    summary: null,
    step_count: 1,
    last_step_response: null,
    reply_provider: "sendblue",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: new Date("2025-01-02T00:00:00Z"),
    has_screenshot: true,
  };

  it("maps a waiting task with approval and screenshot", () => {
    const view = taskView(row as never, (id) => `shot:${id}`);
    expect(view).toMatchObject({
      taskId: "tsk_1",
      question: "Send it?",
      needsApproval: true,
      screenshotUrl: "shot:tsk_1",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-01-02T00:00:00.000Z",
    });
  });

  it("hides the question and screenshot otherwise", () => {
    const view = taskView({ ...row, state: "running", has_screenshot: false } as never, () => "x");
    expect(view.question).toBeNull();
    expect(view.needsApproval).toBe(false);
    expect(view.screenshotUrl).toBeNull();
  });
});

describe("macView", () => {
  const now = new Date("2025-01-01T00:01:00Z");

  it("marks a recent Mac online with sharing state", () => {
    expect(macView({ id: "m", name: "Mini", last_seen_at: "2025-01-01T00:00:30Z" }, true, now)).toEqual({
      deviceId: "m",
      name: "Mini",
      status: "online",
      sharing: true,
      lastSeenAt: "2025-01-01T00:00:30.000Z",
    });
  });

  it("marks old or never-seen Macs offline and never sharing", () => {
    expect(macView({ id: "m", name: "Mini", last_seen_at: "2025-01-01T00:00:00Z" }, true, now).status).toBe("offline");
    expect(macView({ id: "m", name: "Mini", last_seen_at: null }, true, now)).toMatchObject({
      status: "offline",
      sharing: false,
      lastSeenAt: null,
    });
  });
});
