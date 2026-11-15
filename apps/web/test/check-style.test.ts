import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkStyle } from "../scripts/check-style.mjs";

describe("checkStyle", () => {
  it("allows rounded corners on the phone only", () => {
    expect(checkStyle(".phone{border-radius:52px}.cap{border-radius:15px}")).toEqual([]);
    expect(checkStyle(".card{border-radius:8px}")).toHaveLength(1);
  });
  it("rejects shadows", () => {
    expect(checkStyle(".a{box-shadow:0 1px 2px #000}")).toHaveLength(1);
    expect(checkStyle(".a{filter:drop-shadow(0 1px #000)}")).toHaveLength(1);
  });
  it("rejects gradients except the dotted line and edge fades", () => {
    expect(checkStyle(".a{background:linear-gradient(#fff,#000)}")).toHaveLength(1);
    expect(checkStyle(".a{background:repeating-linear-gradient(90deg,red 0 1px,blue 1px 2px)}")).toEqual([]);
    expect(checkStyle(".a{mask-image:linear-gradient(90deg,transparent,#000)}")).toEqual([]);
  });
  it("rejects bouncy easing", () => {
    expect(checkStyle(".a{transition:transform 1s cubic-bezier(.34,1.7,.5,1)}")).toHaveLength(1);
    expect(checkStyle(".a{transition:transform 1s cubic-bezier(.2,.7,.2,1)}")).toEqual([]);
  });
  it("passes the real stylesheet", () => {
    expect(checkStyle(readFileSync(new URL("../app/globals.css", import.meta.url), "utf8"))).toEqual([]);
  });
});
