import { describe, expect, it } from "vitest";
import {
  appCallerIdentity,
  bridgeReady,
  claimCaller,
  mediumOf,
  parseChertJob,
  webhookOwner,
} from "../../../../services/call-agent/src/medium.js";
import { toE164 } from "../../../../services/call-agent/src/tasks.js";

const participant = (over: object = {}) => ({
  identity: "caller",
  isSip: false,
  attributes: {},
  ...over,
});

describe("toE164", () => {
  it.each([
    [undefined, null],
    ["", null],
    ["+14705969455", "+14705969455"],
    ["tel:+44 20 7946 0958", "+442079460958"],
    ["sip:4705969455@sip.example.com", "+14705969455"],
    ["(470) 596-9455", "+14705969455"],
    ["1-470-596-9455", "+14705969455"],
    ["123", null],
    ["+0123", null],
  ])("%j -> %j", (raw, expected) => {
    expect(toE164(raw)).toBe(expected);
  });
});

describe("parseChertJob", () => {
  it.each([
    [undefined, null],
    ["{bad", null],
    ["{}", null],
    [JSON.stringify({ chert_warm: true }), { warm: true, callId: null, video: null }],
    [JSON.stringify({ chert_call: "c1", media: { video: false } }), { warm: false, callId: "c1", video: false }],
    [JSON.stringify({ chert_call: "c1", media: { video: true } }), { warm: false, callId: "c1", video: true }],
  ])("%j", (metadata, expected) => {
    expect(parseChertJob(metadata)).toEqual(expected);
  });
});

describe("bridgeReady", () => {
  it.each([
    [undefined, false],
    ["{bad", false],
    ["{}", false],
    [JSON.stringify({ chert_bridge_ready: true }), true],
  ])("%j -> %s", (metadata, expected) => {
    expect(bridgeReady(metadata)).toBe(expected);
  });
});

describe("appCallerIdentity", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  it.each([
    [undefined, null],
    ["{bad", null],
    [JSON.stringify({ spectr_app_identity: `user:${uuid}` }), `user:${uuid}`],
    [JSON.stringify({ spectr_app_identity: "nope" }), null],
    [JSON.stringify({ spectr_app_identity: 5 }), null],
  ])("%j", (metadata, expected) => {
    expect(appCallerIdentity(metadata)).toBe(expected);
  });
});

describe("webhookOwner", () => {
  const uuid = "123e4567-e89b-42d3-a456-426614174000";
  it.each([
    [undefined, null],
    ["{bad", null],
    [JSON.stringify({ spectr_owner: { ownerId: "nope", deviceId: "Mac_1" } }), null],
    [JSON.stringify({ spectr_owner: { ownerId: uuid, deviceId: "bad id!" } }), null],
    [JSON.stringify({ spectr_owner: { ownerId: uuid.toUpperCase(), deviceId: "Mac_1" } }), { ownerId: uuid, deviceId: "Mac_1" }],
    [JSON.stringify({}), null],
  ])("%j", (metadata, expected) => {
    expect(webhookOwner(metadata)).toEqual(expected);
  });
});

describe("claimCaller", () => {
  it("claims FaceTime for a chert job or bridge participant", () => {
    const viaJob = claimCaller({
      jobMetadata: JSON.stringify({ chert_call: "c1" }),
      roomName: "room",
      participant: participant(),
      facetimeOwnerPhone: "4705969455",
    });
    expect(viaJob).toEqual({ medium: "facetime", phone: "+14705969455" });
    const viaBridge = claimCaller({
      jobMetadata: null,
      roomName: "room",
      participant: participant({ identity: "chert-bridge-1" }),
    });
    expect(viaBridge).toEqual({ medium: "facetime", phone: null });
  });

  it("claims a SIP phone caller or unknown when the number is unusable", () => {
    expect(claimCaller({
      jobMetadata: null,
      roomName: "room",
      participant: participant({ isSip: true, attributes: { "sip.phoneNumber": "4705969455" } }),
    })).toEqual({ medium: "phone", phone: "+14705969455" });
    expect(claimCaller({
      jobMetadata: null,
      roomName: "room",
      participant: participant({ isSip: true, attributes: {} }),
    })).toEqual({ medium: "unknown" });
  });

  it("claims an app caller in a Mac room", () => {
    const uuid = "123e4567-e89b-42d3-a456-426614174000";
    expect(claimCaller({
      jobMetadata: null,
      roomName: "spectr-mac-Mac_1",
      participant: participant({ identity: `user:${uuid}` }),
    })).toEqual({ medium: "app", ownerId: uuid, deviceId: "Mac_1" });
    expect(claimCaller({ jobMetadata: null, roomName: "room", participant: participant() })).toEqual({ medium: "unknown" });
  });
});

describe("mediumOf", () => {
  it.each([
    [{ medium: "unknown" }, "phone"],
    [{ medium: "app", ownerId: "u", deviceId: "d" }, "app"],
    [{ medium: "facetime", phone: null }, "facetime"],
  ] as const)("%j -> %s", (claim, expected) => {
    expect(mediumOf(claim)).toBe(expected);
  });
});
