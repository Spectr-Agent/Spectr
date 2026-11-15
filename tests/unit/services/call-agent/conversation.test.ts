import { describe, expect, it } from "vitest";
import {
  acknowledgement,
  clip,
  greeting,
  GOODBYE,
  isTerminal,
  localHour,
  MOOD,
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
    ["task", `${MOOD.cheerful} Right away.`],
    ["correction", `${MOOD.calm} Understood, changing course.`],
    ["answer", `${MOOD.warm} Thank you.`],
    ["stop", `${MOOD.calm} Stopping.`],
  ] as const)("acknowledgement(%s)", (kind, expected) => {
    expect(acknowledgement(kind)).toBe(expected);
  });

  it("greets per medium and confirms a just-linked number", () => {
    expect(greeting("phone")).toContain("your Mac");
    expect(greeting("facetime")).toContain("looking at your Mac");
    expect(greeting("app")).toContain("with you");
    expect(greeting("phone", { justLinked: true })).toContain("now linked");
    expect(NOT_LINKED).toContain("isn't linked");
    expect(GOODBYE).toBe(`${MOOD.warm} Very good. Goodbye.`);
    expect(ROUTE_FAILED).toContain("couldn't reach");
  });

  it("opens with the time of day, the caller's name and the Mac's state", () => {
    expect(greeting("facetime", { hour: 9, name: "Poorav" })).toBe(
      `${MOOD.warm} Good morning, Poorav. Spectr here. You're looking at your Mac, live. Everything's in order. What may I do for you?`,
    );
    expect(greeting("phone", { hour: 14 })).toContain("Good afternoon. Spectr here");
    expect(greeting("phone", { hour: 20 })).toContain("Good evening.");
    expect(greeting("phone", { hour: 2 })).toContain("Good evening.");
    expect(greeting("phone")).toContain("Hello. Spectr here");
    expect(greeting("phone", { name: "  " })).toContain("Hello. Spectr");
    const asking = status({ state: "waitingForUser", question: "Send the email?" });
    expect(greeting("phone", { active: asking })).toContain("paused on a question for you: Send the email?");
    expect(greeting("phone", { active: status({ state: "running" }) })).toContain("still working on your last task");
    expect(greeting("phone", { active: status({ state: "succeeded" }) })).toContain("Everything's in order");
    expect(greeting("phone", { justLinked: true, hour: 9 })).toMatch(/^\[warmly\] You're all set, this number is now linked to Spectr\. Good morning\./u);
  });

  it("finds the caller's local hour from a time zone", () => {
    const noon = new Date("2026-06-01T16:00:00Z");
    expect(localHour("America/New_York", noon)).toBe(12);
    expect(localHour("Europe/London", noon)).toBe(17);
    expect(localHour(undefined, noon)).toBeUndefined();
    expect(localHour("Not/AZone", noon)).toBeUndefined();
  });

  it("starts every spoken line with a mood tag", () => {
    const tags = Object.values(MOOD);
    const startsWithTag = (line: string) => tags.some((tag) => line.startsWith(`${tag} `));
    for (const line of [greeting("phone"), greeting("facetime", { justLinked: true }), acknowledgement("task"), GOODBYE, NOT_LINKED, ROUTE_FAILED]) {
      expect(startsWithTag(line)).toBe(true);
    }
    expect(startsWithTag(narration(null, status({ state: "succeeded", summary: "x" })) ?? "")).toBe(true);
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
    expect(narration(null, waiting)).toBe(`${MOOD.curious} Send it?`);
    expect(narration(waiting, waiting)).toBeNull();
    expect(narration(waiting, { ...waiting, question: null })).toBeNull();
    expect(narration(null, { ...waiting, taskId: "t2", question: "Delete all?" })).toBe(`${MOOD.curious} Delete all?`);

    expect(narration(null, status({ state: "succeeded", summary: "Note written" }))).toBe(`${MOOD.cheerful} Done. Note written`);
    expect(narration(null, status({ state: "succeeded" }))).toBe(`${MOOD.cheerful} Done.`);
    expect(narration(status({ state: "succeeded" }), status({ state: "succeeded", summary: "x" }))).toBeNull();
    expect(narration(null, status({ state: "failed", summary: "No app" }))).toBe(`${MOOD.sorry} I'm afraid I couldn't finish that. No app`);
    expect(narration(null, status({ state: "failed" }))).toBe(`${MOOD.sorry} I'm afraid I couldn't finish that.`);
    expect(narration(status({ state: "failed" }), status({ state: "failed", summary: "x" }))).toBeNull();
    expect(narration(null, status({ state: "cancelled" }))).toBe(`${MOOD.calm} Stopped.`);
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
