import { describe, expect, it } from "vitest";
import {
  acknowledgement,
  clip,
  greeting,
  GOODBYE,
  isTerminal,
  narration,
  NOT_LINKED,
  ROUTE_FAILED,
  utteranceAction,
  type TaskStatus,
} from "../../../../services/call-agent/src/conversation.js";

const status = (over: Partial<TaskStatus> = {}): TaskStatus => ({
  taskId: "t1",
  state: "running",
  revision: 1,
  question: null,
  summary: null,
  ...over,
});

describe("utteranceAction", () => {
  it.each([
    ["hi", false, { type: "greeting" }],
    ["hello spectr!", false, { type: "greeting" }],
    ["hi", true, { type: "route", text: "hi" }],
    ["bye!", false, { type: "goodbye" }],
    ["x", false, { type: "ignore" }],
    ["  ", false, { type: "ignore" }],
  ])("%j active=%s", (text, active, expected) => {
    expect(utteranceAction(text, active)).toEqual(expected);
  });

  it("caps routed text at 2000 chars", () => {
    const action = utteranceAction("a".repeat(3_000), false);
    expect(action.type).toBe("route");
    expect((action as { text: string }).text).toHaveLength(2_000);
  });
});

describe("phrases", () => {
  it.each([
    ["task", "On it."],
    ["correction", "Got it, changing that."],
    ["answer", "Thanks."],
    ["stop", "Stopping."],
  ] as const)("acknowledgement(%s)", (kind, expected) => {
    expect(acknowledgement(kind)).toBe(expected);
  });

  it("greets per medium and confirms a just-linked number", () => {
    expect(greeting("phone")).toContain("your Mac");
    expect(greeting("facetime")).toContain("looking at your Mac");
    expect(greeting("app")).toContain("with you");
    expect(greeting("phone", true)).toContain("now linked");
    expect(NOT_LINKED).toContain("isn't linked");
    expect(GOODBYE).toBe("Okay. Bye.");
    expect(ROUTE_FAILED).toContain("couldn't reach");
  });
});

describe("clip", () => {
  it("returns short text and collapses whitespace", () => {
    expect(clip("a\nb   c")).toBe("a b c");
  });

  it("cuts at the last sentence stop when one is late enough", () => {
    const text = `${"a".repeat(200)}. tail${"b".repeat(200)}`;
    const cut = clip(text, 300);
    expect(cut).toHaveLength(201);
    expect(cut.endsWith(".")).toBe(true);
  });

  it("trims the last partial word when there is no sentence stop", () => {
    const text = `${"a".repeat(295)} ${"b".repeat(50)}`;
    expect(clip(text, 300)).toBe("a".repeat(295));
  });
});

describe("narration", () => {
  it("says nothing for unchanged status or mid-flight states", () => {
    const s = status();
    expect(narration(s, s)).toBeNull();
    expect(narration(null, status({ state: "accepted" }))).toBeNull();
    expect(narration(null, s)).toBeNull();
  });

  it("narrates a question once and terminal states with a summary", () => {
    const waiting = status({ state: "waitingForUser", question: "Send it?" });
    expect(narration(null, waiting)).toBe("Send it?");
    expect(narration(waiting, waiting)).toBeNull();
    expect(narration(waiting, { ...waiting, question: null })).toBeNull();
    expect(narration(null, { ...waiting, taskId: "t2", question: "Delete all?" })).toBe("Delete all?");

    expect(narration(null, status({ state: "succeeded", summary: "Note written" }))).toBe("Done. Note written");
    expect(narration(null, status({ state: "succeeded" }))).toBe("Done.");
    expect(narration(status({ state: "succeeded" }), status({ state: "succeeded", summary: "x" }))).toBeNull();
    expect(narration(null, status({ state: "failed", summary: "No app" }))).toBe("I couldn't finish that. No app");
    expect(narration(null, status({ state: "failed" }))).toBe("I couldn't finish that.");
    expect(narration(status({ state: "failed" }), status({ state: "failed", summary: "x" }))).toBeNull();
    expect(narration(null, status({ state: "cancelled" }))).toBe("Stopped.");
    expect(narration(status({ state: "cancelled" }), status({ state: "cancelled" }))).toBeNull();
  });
});

describe("isTerminal", () => {
  it.each([
    ["succeeded", true],
    ["failed", true],
    ["cancelled", true],
    ["running", false],
    ["accepted", false],
    ["waitingForUser", false],
  ] as const)("%s -> %s", (state, expected) => {
    expect(isTerminal(state)).toBe(expected);
  });
});
