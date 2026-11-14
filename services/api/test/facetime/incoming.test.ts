import { createHmac } from "node:crypto";
import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import {
  bridgeToken,
  callRoomName,
  createChertCallChecker,
  handleFaceTimeWebhook,
  type FaceTimeDeps,
} from "../../src/facetime/incoming.js";

const env = {
  LIVEKIT_URL: "wss://project.livekit.test",
  LIVEKIT_API_KEY: "APItestkey",
  LIVEKIT_API_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
};
const OWNER = { ownerId: "589aefe5-4901-4118-a761-90f5d86a737f", deviceId: "mac-jared" };

function deps(overrides: Partial<FaceTimeDeps> = {}) {
  const dispatched: Array<[string, Record<string, unknown>]> = [];
  const value: FaceTimeDeps = {
    confirmCall: async () => true,
    resolveOwner: async () => OWNER,
    dispatchAgent: async (room, metadata) => {
      dispatched.push([room, metadata]);
    },
    now: () => new Date(),
    ...overrides,
  };
  return { value, dispatched };
}

const incoming = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    event_id: "evt_1",
    type: "call.incoming",
    created_at: "2026-11-14T20:00:00Z",
    data: { call_id: "call_abc", line_id: "line_1", media: { audio: true, video: true }, from_handle_hash: null, ...extra },
  });

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("https://api.test/api/chert/facetime", { method: "POST", body, headers });

describe("FaceTime webhook", () => {
  it("answers a confirmed call with a bridge token for that call's room only, and dispatches the agent", async () => {
    const { value, dispatched } = deps();
    const response = await handleFaceTimeWebhook(post(incoming()), env, value);
    const body = (await response.json()) as Record<string, string>;
    expect(body.action).toBe("accept");
    expect(body.livekit_url).toBe(env.LIVEKIT_URL);
    expect(body.remote_participant_identity).toBe("spectr-agent");
    const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(body.participant_token);
    expect(claims.sub).toBe("chert-bridge-call_abc");
    expect(claims.video?.room).toBe("spectr-ft-call_abc");
    expect(claims.video?.canPublish && claims.video?.canSubscribe && claims.video?.roomJoin).toBe(true);
    expect((claims.exp ?? 0) - (claims.nbf ?? 0)).toBeLessThanOrEqual(7200);
    expect(dispatched).toEqual([
      [
        "spectr-ft-call_abc",
        { chert_call: "call_abc", media: { audio: true, video: true }, spectr_owner: OWNER, spectr_poll_bridge: true },
      ],
    ]);
  });

  it("declines a call Chert doesn't confirm, and never dispatches for it", async () => {
    const { value, dispatched } = deps({ confirmCall: async () => false });
    expect(await (await handleFaceTimeWebhook(post(incoming()), env, value)).json()).toEqual({ action: "decline" });
    expect(dispatched).toEqual([]);
  });

  it("declines when the line has no owner with a Mac", async () => {
    const { value } = deps({ resolveOwner: async () => null });
    expect(await (await handleFaceTimeWebhook(post(incoming()), env, value)).json()).toEqual({ action: "decline" });
  });

  it("declines a call for another line", async () => {
    const { value, dispatched } = deps();
    const response = await handleFaceTimeWebhook(post(incoming()), { ...env, CHERT_LINE_ID: "line_other" }, value);
    expect(await response.json()).toEqual({ action: "decline" });
    expect(dispatched).toEqual([]);
  });

  it("requires a valid signature when a secret is configured", async () => {
    const secret = "whsec_test";
    const body = incoming();
    const t = Math.floor(Date.now() / 1000);
    const v1 = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const { value } = deps();
    const signedEnv = { ...env, CHERT_FACETIME_WEBHOOK_SECRET: secret };
    expect((await handleFaceTimeWebhook(post(body), signedEnv, value)).status).toBe(401);
    const ok = await handleFaceTimeWebhook(post(body, { "x-webhook-signature": `t=${t},v1=${v1}` }), signedEnv, value);
    expect(((await ok.json()) as { action: string }).action).toBe("accept");
  });

  it("acknowledges other events without deciding anything", async () => {
    const { value, dispatched } = deps();
    const response = await handleFaceTimeWebhook(post(JSON.stringify({ type: "call.ended", data: { call_id: "c" } })), env, value);
    expect(await response.json()).toEqual({ ok: true });
    expect(dispatched).toEqual([]);
  });

  it("confirms calls with Chert and fails closed", async () => {
    const reply = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });
    const config = { apiKey: "ftk_x", projectId: "p" };
    expect(await createChertCallChecker(config, reply(200, { id: "c", status: "ringing", line_id: "line_1" }))("c", "line_1")).toBe(true);
    expect(await createChertCallChecker(config, reply(200, { status: "ended" }))("c", "line_1")).toBe(false);
    expect(await createChertCallChecker(config, reply(200, { status: "ringing", line_id: "other" }))("c", "line_1")).toBe(false);
    expect(await createChertCallChecker(config, reply(404, {}))("c", "line_1")).toBe(false);
    expect(await createChertCallChecker(config, async () => { throw new Error("down"); })("c", "line_1")).toBe(false);
  });

  it("names rooms per call", async () => {
    expect(callRoomName("call_abc")).toBe("spectr-ft-call_abc");
    await expect(bridgeToken({ apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET }, "r", "c")).resolves.toMatch(/^eyJ/u);
  });
});
