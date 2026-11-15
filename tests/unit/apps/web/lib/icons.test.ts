import { describe, expect, it } from "vitest";
import { ICONS, type IconName } from "../../../../../apps/web/lib/icons.js";

// Moves, lines, curves and close-path, in absolute or relative form.
const PATH = /^[MLHVCZmlhvcz0-9 ,.-]+$/u;

describe("icons", () => {
  const entries = Object.entries(ICONS) as [IconName, string][];

  it("defines the icons the landing page draws", () => {
    for (const name of ["facetime", "phone", "screen", "stop", "lock"] as IconName[]) {
      expect(ICONS[name]).toBeTypeOf("string");
    }
  });

  it.each(entries)("%s is path data that starts with a move", (_name, path) => {
    expect(path).toMatch(PATH);
    expect(path.startsWith("M")).toBe(true);
  });

  it.each(entries)("%s stays inside the 24 by 24 grid", (_name, path) => {
    // Absolute M, L, H and V only: every number after them is a coordinate.
    for (const segment of path.match(/[MLHV][^MLHVCZmlhvcz]*/gu) ?? []) {
      for (const value of segment.slice(1).trim().split(/[\s,]+/u).filter(Boolean)) {
        const number = Number(value);
        expect(Number.isFinite(number)).toBe(true);
        expect(number).toBeGreaterThanOrEqual(0);
        expect(number).toBeLessThanOrEqual(24);
      }
    }
  });
});
