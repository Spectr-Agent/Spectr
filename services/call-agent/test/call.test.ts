import { describe, expect, it } from "vitest";
import { CallSession } from "../src/call.js";
import {
  acknowledgement,
  clip,
  greeting,
  narration,
  NOT_LINKED,
  ROUTE_FAILED,
  type InboundKind,
  type TaskStatus,
  utteranceAction,
} from "../src/conversation.js";
import { bridgeReady, claimCaller, parseChertJob } from "../src/medium.js";
import { toE164, type Caller, type TaskGateway } from "../src/tasks.js";

const caller: Caller = { ownerId: "owner-1", deviceId: "mac-1", handle: "+14045550100" };

class FakeGateway implements TaskGateway {
  routed: { text: string; utteranceId: string }[] = [];
  statuses: TaskStatus[] = [];
  active: TaskStatus | null = null;
  failRoute = false;
  nextKind: InboundKind = "task";

  async route(_caller: Caller, text: string, utteranceId: string) {
    if (this.failRoute) throw new Error("db down");
    this.routed.push({ text, utteranceId });
    return { taskId: "tsk_1", kind: this.nextKind };
  }

  async status() {
    return this.statuses.shift() ?? null;
  }

  async activeTask() {
    return this.active;
  }
}

function status(state: TaskStatus["state"], extra: Partial<TaskStatus> = {}): TaskStatus {
  return { taskId: "tsk_1", state, revision: 1, question: null, summary: null, ...extra };
}

function harness(gateway = new FakeGateway()) {
  const said: string[] = [];
  let hungUp = false;
  const call = new CallSession("call_1", "phone", caller, gateway, {
    say: (text) => said.push(text),
    hangUp: () => {
      hungUp = true;
    },
  }, 0);
  return { call, gateway, said, hungUp: () => hungUp };
}

describe("utterances", () => {
  it("ignores noise and empty transcripts", () => {
    expect(utteranceAction("", false)).toEqual({ type: "ignore" });
    expect(utteranceAction("a", false)).toEqual({ type: "ignore" });
  });

  it("answers a greeting without creating a task, but routes it once a task is running", () => {
    expect(utteranceAction("Hello!", false)).toEqual({ type: "greeting" });
    expect(utteranceAction("Hello!", true)).toEqual({ type: "route", text: "Hello!" });
  });

  it("recognizes goodbye", () => {
    expect(utteranceAction("Okay that's all.", false).type).toBe("route");
    expect(utteranceAction("That's all.", false)).toEqual({ type: "goodbye" });
  });

  it("routes instructions verbatim and caps their length", () => {
    expect(utteranceAction("open Notes and write milk", false)).toEqual({ type: "route", text: "open Notes and write milk" });
    const long = utteranceAction("x".repeat(3_000), false);
    expect(long.type === "route" && long.text.length).toBe(2_000);
  });
});

describe("narration", () => {
  it("speaks a new question once", () => {
    const asking = status("waitingForUser", { question: "Send this message?" });
    expect(narration(status("running"), asking)).toBe("[curious] Send this message?");
    expect(narration(asking, asking)).toBeNull();
  });

  it("reports verified success, failure and stop exactly once", () => {
    const done = status("succeeded", { summary: "Notes shows milk." });
    expect(narration(status("running"), done)).toBe("[cheerfully] Done. Notes shows milk.");
    expect(narration(done, done)).toBeNull();
    expect(narration(status("running"), status("failed", { summary: "Notes isn't installed." }))).toBe(
      "[apologetic] I'm afraid I couldn't finish that. Notes isn't installed.",
    );
    expect(narration(status("running"), status("cancelled"))).toBe("[calmly] Stopped.");
  });

  it("says nothing while the task is just running", () => {
    expect(narration(status("accepted"), status("running"))).toBeNull();
  });

  it("clips long text at a sentence boundary", () => {
    const text = "First sentence is here. " + "word ".repeat(100);
    expect(clip(text, 60).endsWith(".")).toBe(true);
    expect(clip(text, 60).length).toBeLessThanOrEqual(60);
  });
});

describe("a call", () => {
  it("greets, routes an instruction, acknowledges it and narrates the verified result", async () => {
    const { call, gateway, said } = harness();
    await call.begin();
    expect(said).toEqual([greeting("phone")]);

    gateway.statuses.push(status("running"));
    await call.hear("open Notes and write milk");
    expect(gateway.routed).toEqual([{ text: "open Notes and write milk", utteranceId: "call:call_1:1" }]);
    expect(said.at(-1)).toBe(acknowledgement("task"));

    gateway.statuses.push(status("succeeded", { summary: "The note says milk." }));
    await call.poll();
    expect(said.at(-1)).toBe("[cheerfully] Done. The note says milk.");
    await call.poll();
    expect(said.filter((line) => line.includes("Done")).length).toBe(1);
  });

  it("sends a correction and a stop through the same pipeline with distinct utterance IDs", async () => {
    const { call, gateway, said } = harness();
    gateway.active = status("running");
    await call.begin();
    gateway.nextKind = "correction";
    gateway.statuses.push(status("running", { revision: 2 }));
    await call.hear("actually write eggs");
    gateway.nextKind = "stop";
    gateway.statuses.push(status("cancelled", { revision: 3 }));
    await call.hear("stop");
    expect(gateway.routed.map((r) => r.utteranceId)).toEqual(["call:call_1:1", "call:call_1:2"]);
    expect(said).toContain(acknowledgement("correction"));
    expect(said).toContain(acknowledgement("stop"));
  });

  it("treats a greeting during a running task as an instruction for the agent", async () => {
    const { call, gateway } = harness();
    gateway.active = status("running");
    await call.begin();
    gateway.statuses.push(status("running"));
    await call.hear("hello");
    expect(gateway.routed.length).toBe(1);
  });

  it("says so when the pipeline can't be reached, without claiming anything happened", async () => {
    const { call, gateway, said } = harness();
    gateway.failRoute = true;
    await call.hear("open Safari");
    expect(said.at(-1)).toBe(ROUTE_FAILED);
  });

  it("hangs up on goodbye and ignores anything after", async () => {
    const { call, gateway, said, hungUp } = harness();
    await call.hear("goodbye");
    expect(hungUp()).toBe(true);
    await call.hear("open Notes");
    expect(gateway.routed.length).toBe(0);
    expect(said.length).toBe(1);
  });
});

describe("caller identification", () => {
  const sip = { identity: "sip_+14045550100", isSip: true, attributes: { "sip.phoneNumber": "+1 (404) 555-0100" } };

  it("identifies a phone caller by caller ID", () => {
    expect(claimCaller({ jobMetadata: "", roomName: "call-123", participant: sip })).toEqual({
      medium: "phone",
      phone: "+14045550100",
    });
  });

  it("refuses a phone call with no usable caller ID", () => {
    expect(
      claimCaller({ jobMetadata: "", roomName: "call-1", participant: { ...sip, attributes: {} } }),
    ).toEqual({ medium: "unknown" });
  });

  it("binds a FaceTime call to the configured owner, and to no one without it", () => {
    const bridge = { identity: "chert-bridge-abc", isSip: false, attributes: {} };
    expect(
      claimCaller({ jobMetadata: '{"chert_warm":true}', roomName: "r", participant: bridge, facetimeOwnerPhone: "4045550100" }),
    ).toEqual({ medium: "facetime", phone: "+14045550100" });
    expect(claimCaller({ jobMetadata: '{"chert_warm":true}', roomName: "r", participant: bridge })).toEqual({
      medium: "facetime",
      phone: null,
    });
  });

  it("identifies an app caller only in a Mac room with a user identity", () => {
    const user = { identity: "user:0f8fad5b-d9cb-469f-a165-70867728950e", isSip: false, attributes: {} };
    expect(claimCaller({ jobMetadata: "", roomName: "spectr-mac-dev_1", participant: user })).toEqual({
      medium: "app",
      ownerId: "0f8fad5b-d9cb-469f-a165-70867728950e",
      deviceId: "dev_1",
    });
    expect(claimCaller({ jobMetadata: "", roomName: "other-room", participant: user })).toEqual({ medium: "unknown" });
  });

  it("parses Chert job and room metadata", () => {
    expect(parseChertJob('{"chert_call":"c1","media":{"audio":true,"video":false}}')).toEqual({
      warm: false,
      callId: "c1",
      video: false,
    });
    expect(parseChertJob("not json")).toBeNull();
    expect(parseChertJob('{"other":1}')).toBeNull();
    expect(bridgeReady('{"chert_call":"c1","chert_bridge_ready":true}')).toBe(true);
    expect(bridgeReady("{}")).toBe(false);
    expect(bridgeReady("garbage")).toBe(false);
  });

  it("normalizes phone numbers", () => {
    expect(toE164("tel:+14045550100")).toBe("+14045550100");
    expect(toE164("sip:+14045550100@pstn.example")).toBe("+14045550100");
    expect(toE164("(404) 555-0100")).toBe("+14045550100");
    expect(toE164("14045550100")).toBe("+14045550100");
    expect(toE164("555")).toBeNull();
    expect(toE164(undefined)).toBeNull();
  });

  it("has a clear message for unlinked callers", () => {
    expect(NOT_LINKED).toMatch(/isn't linked/u);
  });
});

describe("app calls and number linking", () => {
  it("reads the app caller's identity only from a well-formed dispatch", async () => {
    const { appCallerIdentity } = await import("../src/medium.js");
    expect(appCallerIdentity(JSON.stringify({ spectr_app_identity: "user:589aefe5-4901-4118-a761-90f5d86a737f" }))).toBe(
      "user:589aefe5-4901-4118-a761-90f5d86a737f",
    );
    expect(appCallerIdentity(JSON.stringify({ spectr_app_identity: "mac-mac-1" }))).toBeNull();
    expect(appCallerIdentity("not json")).toBeNull();
    expect(appCallerIdentity(undefined)).toBeNull();
  });

  it("confirms a newly linked number before the usual greeting", async () => {
    const { greeting, NOT_LINKED } = await import("../src/conversation.js");
    expect(greeting("phone", true)).toMatch(/^\[warmly\] You're all set, this number is now linked/u);
    expect(greeting("app")).toContain("on your Mac with you");
    expect(NOT_LINKED).toContain("Setup");
  });
});

describe("FaceTime calls answered by the webhook", () => {
  it("trusts only a well-formed owner from the dispatch", async () => {
    const { webhookOwner } = await import("../src/medium.js");
    const owner = { ownerId: "589aefe5-4901-4118-a761-90f5d86a737f", deviceId: "mac-jared" };
    expect(webhookOwner(JSON.stringify({ spectr_owner: owner }))).toEqual(owner);
    expect(webhookOwner(JSON.stringify({ spectr_owner: { ownerId: "x", deviceId: "mac" } }))).toBeNull();
    expect(webhookOwner("{}")).toBeNull();
  });

  it("greets only once Chert reports the bridge ready, and stops when the call is over", async () => {
    const { callBridgeReady } = await import("../src/medium.js");
    expect(callBridgeReady({ status: "ringing", facetime_call_events: [] })).toBe("waiting");
    expect(callBridgeReady({ status: "active", facetime_call_events: [{ type: "accepted" }] })).toBe("waiting");
    expect(callBridgeReady({ status: "active", facetime_call_events: [{ type: "bridge_ready", source: "worker" }] })).toBe("ready");
    expect(callBridgeReady({ status: "ended" })).toBe("over");
  });
});
