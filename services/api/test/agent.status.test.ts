// Keeps Jared's handoff files in sync with the code and valid against contracts.ts.
// After changing a status line or case, regenerate the JSON with:
//   UPDATE_FIXTURES=1 npx vitest run test/agent.status.test.ts

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MacActionSchema, MacStepResponseSchema } from "../src/contracts.js";
import { EXAMPLE_ACTIONS, GUARDRAIL_CASES, exportHandoffCases } from "../src/agent/handoffCases.js";
import { MAX_STATUS_LENGTH, exportStatusStrings, status, statusForAction, statusForResponse } from "../src/agent/status.js";

const fixture = (name: string) => new URL(`../src/agent/fixtures/${name}`, import.meta.url);
const mascot = (name: string, folder: string) => new URL(`../../../assets/mascot/${folder}/${name}.png`, import.meta.url);

function inSync(name: string, value: unknown) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  if (process.env.UPDATE_FIXTURES === "1") writeFileSync(fixture(name), text);
  expect(readFileSync(fixture(name), "utf8"), `${name} is out of date; regenerate it`).toBe(text);
}

describe("Jared handoff files", () => {
  it("status-strings.json matches status.ts", () => inSync("status-strings.json", exportStatusStrings()));
  it("guardrail-cases.json matches handoffCases.ts", () => inSync("guardrail-cases.json", exportHandoffCases()));

  it.each(exportStatusStrings().map((s) => [s.key, s] as const))("%s is short and uses a real mascot", (_key, s) => {
    expect(s.template.length).toBeLessThanOrEqual(MAX_STATUS_LENGTH);
    expect(existsSync(mascot(s.mascot, "must_have")) || existsSync(mascot(s.mascot, "nice_to_have"))).toBe(true);
  });

  it("every example action is valid for the Mac helper", () => {
    const types = new Set<string>();
    for (const { name, action } of EXAMPLE_ACTIONS) {
      expect(MacActionSchema.safeParse(action).success, name).toBe(true);
      types.add(action.type);
    }
    // One of every action type the contract allows.
    const allowed = MacActionSchema.options.map((o) => o.shape.type.value);
    expect([...types].sort()).toEqual([...allowed].sort());
  });

  it("every guardrail case is a valid step response", () => {
    for (const { name, response } of GUARDRAIL_CASES) {
      expect(MacStepResponseSchema.safeParse(response).success, name).toBe(true);
    }
  });

  it("status lines work for any app and never repeat typed text", () => {
    expect(statusForAction({ type: "openApp", name: "Figma" })).toBe("Opening Figma.");
    expect(statusForAction({ type: "openUrl", url: "https://www.youtube.com/watch?v=1" })).toBe("Opening youtube.com.");
    expect(statusForAction({ type: "key", keys: "cmd+shift+t", repeat: 1 })).toBe("Pressing Command-Shift-T.");
    expect(statusForAction({ type: "type", text: "my secret note" })).toBe("Typing.");
    expect(statusForResponse({ kind: "finished", taskId: "t", step: 1, state: "succeeded", summary: "Notes is open." })).toBe(
      "Done: Notes is open.",
    );
    expect(statusForResponse({ kind: "finished", taskId: "t", step: 1, state: "cancelled", summary: "x" })).toBe("Stopped.");
    expect(status("macOffline", { lastSeen: "at 3:42 PM" })).toBe("Your Mac is offline. Last seen at 3:42 PM.");
  });
});
