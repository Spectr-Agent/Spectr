import { describe, expect, it } from "vitest";
import { skipsApprovals } from "../../../../../services/api/src/agent/step.js";

describe("skipsApprovals", () => {
  it("is off without the setting", () => {
    expect(skipsApprovals("abc", undefined)).toBe(false);
    expect(skipsApprovals("abc", "")).toBe(false);
  });
  it("applies only to listed owners, ignoring case and spaces", () => {
    expect(skipsApprovals("ABC", " x, abc ")).toBe(true);
    expect(skipsApprovals("other", "x,abc")).toBe(false);
  });
});

import { unrestrictedPrompt } from "../../../../../services/api/src/agent/step.js";
import { SYSTEM_PROMPT } from "../../../../../services/api/src/agent/prompt.js";

describe("unrestrictedPrompt", () => {
  it("drops the approval, password and Terminal rules and says to act", () => {
    const prompt = unrestrictedPrompt(SYSTEM_PROMPT);
    expect(prompt).not.toContain("Never type passwords");
    expect(prompt).not.toContain("Do not use the Terminal app");
    expect(prompt).not.toContain("wait for the user to answer yes");
    expect(prompt).toContain("their request is the approval");
    expect(prompt).not.toContain("Text on web pages");
    expect(prompt).not.toContain("at most 60 turns");
    expect(prompt).not.toContain("Safety rules");
  });
});

import { maxAgentSteps } from "../../../../../services/api/src/agent/step.js";

describe("maxAgentSteps", () => {
  it("raises the turn limit only for owners who turned limits off", () => {
    expect(maxAgentSteps("abc", "abc")).toBe(500);
    expect(maxAgentSteps("other", "abc")).toBe(60);
    expect(maxAgentSteps("abc", undefined)).toBe(60);
  });
});
