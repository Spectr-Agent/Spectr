import { describe, expect, it } from "vitest";
import { images, type ImageKey } from "../../../../../apps/web/lib/images.js";
import { GITHUB_URL, SITE_URL } from "../../../../../apps/web/lib/site.js";
import { isAction, type Step } from "../../../../../apps/web/lib/thread.js";

describe("images", () => {
  it("exposes every mascot asset the site uses", () => {
    const keys: ImageKey[] = [
      "automation",
      "favicon",
      "launch",
      "listening",
      "logo",
      "pairing",
      "screen",
      "stopped",
      "success",
      "waiting",
      "welcome",
      "working",
    ];
    expect(Object.keys(images).sort()).toEqual([...keys].sort());
    for (const key of keys) {
      expect(images[key], `images.${key}`).toBeTruthy();
    }
  });
});

describe("site", () => {
  it("points at the public repo and mirrors the configured site URL", () => {
    expect(GITHUB_URL).toBe("https://github.com/Spectr-Agent/Spectr");
    expect(SITE_URL).toBe(process.env.NEXT_PUBLIC_SITE_URL || undefined);
  });
});

describe("isAction", () => {
  it("distinguishes Mac action steps from message steps", () => {
    const action: Step = { action: "mac" };
    const message: Step = { from: "bot", text: "hi" };
    expect(isAction(action)).toBe(true);
    expect(isAction(message)).toBe(false);
  });
});
