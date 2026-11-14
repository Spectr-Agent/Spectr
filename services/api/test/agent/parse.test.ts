import { describe, expect, it } from "vitest";
import { ActionSchema } from "../../src/agent/actions.js";
import { parseUtterance, UNKNOWN_REPLY, VAGUE_REPLY } from "../../src/agent/parse.js";
import { makeState } from "./helpers.js";

const at = (observedSlide: number | null) => makeState({ observedSlide, frontApp: "Keynote" });

describe("parseUtterance", () => {
  it.each(["stop", "Stop!", "cancel", "cancel that", "hold on", "halt", "abort", "never mind", "please stop now", "wait stop"])(
    "1. %s -> stop",
    (u) => {
      expect(parseUtterance(u, at(2))).toEqual({ type: "stop" });
    },
  );

  it.each([
    ["wait, slide 3", 3],
    ["no slide four", 4],
    ["nope, slide 2", 2],
    ["sorry, slide one", 1],
    ["actually slide five", 5],
    ["actually five", 5],
    ["make it 3", 3],
    ["change it to slide two", 2],
    ["I meant slide 4", 4],
  ])("2. correction %s -> slide %i", (u, n) => {
    expect(parseUtterance(u, at(1))).toEqual({ type: "goToSlide", number: n });
  });

  it.each(["open the demo deck", "open the deck", "Open the deck."])("3. %s -> openDemoDeck", (u) => {
    expect(parseUtterance(u, at(null))).toEqual({ type: "openDemoDeck" });
  });

  it.each([
    ["slide 4", 4],
    ["go to slide four", 4],
    ["slide number four", 4],
    ["slide for", 4],
    ["slide to", 2],
    ["slide too", 2],
    ["slide won", 1],
    ["go to slide 12", 12],
  ])("4. %s -> slide %i", (u, n) => {
    expect(parseUtterance(u, at(1))).toEqual({ type: "goToSlide", number: n });
  });

  it("4. speech-mistake words alone are not slide numbers", () => {
    expect(parseUtterance("to", at(1)).type).toBe("refuse");
  });

  it("5. first and last", () => {
    expect(parseUtterance("first slide", at(3))).toEqual({ type: "goToSlide", number: 1 });
    expect(parseUtterance("go to the last slide", at(3))).toEqual({ type: "goToSlide", number: 5 });
    expect(parseUtterance("last slide", makeState({ deckLength: 9 }))).toEqual({ type: "goToSlide", number: 9 });
  });

  it.each([
    ["next", 3],
    ["next slide", 3],
    ["forward", 3],
    ["go to the next slide", 3],
    ["back", 1],
    ["previous", 1],
    ["go back", 1],
  ])("6. %s from slide 2 -> slide %i", (u, n) => {
    expect(parseUtterance(u, at(2))).toEqual({ type: "goToSlide", number: n });
  });

  it("6. does not clamp; the gate refuses out of range", () => {
    expect(parseUtterance("next", at(5))).toEqual({ type: "goToSlide", number: 6 });
    expect(parseUtterance("back", at(1))).toEqual({ type: "goToSlide", number: 0 });
  });

  it.each(["next", "back", "previous slide"])("6. %s with unknown slide -> lookAtScreen", (u) => {
    expect(parseUtterance(u, at(null))).toEqual({ type: "lookAtScreen" });
  });

  it.each(["that one", "the good one", "the other one", "go to the good one"])("7. %s -> askQuestion", (u) => {
    expect(parseUtterance(u, at(2))).toEqual({ type: "askQuestion", text: VAGUE_REPLY });
  });

  it.each([
    ["open Safari", "Safari"],
    ["launch Notes", "Notes"],
    ["please open Google Chrome.", "Google Chrome"],
    ["open the Notes app", "Notes"],
    ["open Terminal", "Terminal"],
  ])("8. %s -> openApp %s", (u, name) => {
    expect(parseUtterance(u, at(null))).toEqual({ type: "openApp", name });
  });

  it.each(["email all my files", "", "what's the weather", "rm -rf /"])("9. %j -> refuse", (u) => {
    expect(parseUtterance(u, at(2))).toEqual({ type: "refuse", reason: UNKNOWN_REPLY });
  });

  it("always returns a schema-valid action", () => {
    for (const u of ["stop", "slide 3", "open Safari", "??", "next", "that one"]) {
      expect(ActionSchema.safeParse(parseUtterance(u, at(2))).success).toBe(true);
    }
  });
});
