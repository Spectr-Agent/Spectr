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
