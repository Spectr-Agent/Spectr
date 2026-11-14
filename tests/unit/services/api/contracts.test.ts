import { describe, expect, it } from "vitest";
import { MacActionSchema, MacStepRequestSchema } from "../../../../services/api/src/contracts.js";

const key = (keys: string) => ({ type: "key", keys, repeat: 1 });

describe("MacActionSchema key combos", () => {
  it.each([
    ["cmd+shift+4", true],
    ["+", true],
    ["cmd+", false],
    ["cmd++a", false],
    ["cmd+cmd+a", false],
    ["win+a", false],
  ])("keys %j valid=%s", (keys, valid) => {
    expect(MacActionSchema.safeParse(key(keys)).success).toBe(valid);
  });
});

describe("MacActionSchema urls", () => {
  it.each([
    ["https://example.com", true],
    ["http://localhost:3000", true],
    ["not a url", false],
    ["ftp://example.com", false],
  ])("url %j valid=%s", (url, valid) => {
    expect(MacActionSchema.safeParse({ type: "openUrl", url }).success).toBe(valid);
  });
});

const request = (width: number, height: number) => ({
  taskId: "tsk_1",
  afterStep: 0,
  screenshot: { mediaType: "image/png", data: "AA==", width, height },
  results: [],
});

describe("MacStepRequestSchema screenshot limits", () => {
  it("rejects a long edge over 2576 pixels", () => {
    const parsed = MacStepRequestSchema.safeParse(request(3000, 10));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("2576");
  });

  it("rejects a screenshot over the image block token limit", () => {
    // 56 * 86 = 4816 > 4784 blocks of 28px, while the long edge stays under 2576.
    const parsed = MacStepRequestSchema.safeParse(request(1568, 2400));
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toContain("image block limit");
  });

  it("accepts a screenshot within both limits", () => {
    expect(MacStepRequestSchema.safeParse(request(1280, 800)).success).toBe(true);
  });
});
