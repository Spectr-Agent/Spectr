import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createChertReplier } from "../../../../services/api/src/chert/client.js";
import { normalizeChertEvent } from "../../../../services/api/src/chert/normalize.js";
import { createChertWebhookRoute } from "../../../../services/api/src/chert/route.js";
import { verifyChertSignature } from "../../../../services/api/src/chert/verify.js";
import { handleChertWebhook } from "../../../../services/api/src/chert/webhook.js";
import type { InboundDeps } from "../../../../services/api/src/inbound.js";

const inboundDeps = (): InboundDeps => ({
  store: { routeInbound: async () => ({ taskId: "t1", kind: "task", created: true }) } as never,
  provider: "chert",
  resolveSender: async () => ({ ownerId: "o", deviceId: "d" }),
  sendReply: async () => undefined,
});

const sign = (body: string, secret: string, t: number) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`, "utf8").digest("hex")}`;

describe("createChertReplier gaps", () => {
  it("maps a network failure to a request error", async () => {
    const send = createChertReplier({
      apiKey: "k",
      projectId: "p",
      lineId: "l",
      fetch: (async () => { throw new Error("down"); }) as typeof fetch,
    });
    await expect(send("+2", "hi", "k")).rejects.toThrow("Chert reply request failed");
  });
});

describe("verifyChertSignature gaps", () => {
  const body = "{}";
  const now = 1_700_000_000;

  it("accepts the new and legacy header formats", () => {
    const good = sign(body, "s", now);
    expect(verifyChertSignature(body, { "X-Webhook-Signature": good }, "s", { nowSeconds: now })).toBe(true);
    const legacy = `v1,${now},${createHmac("sha256", "s").update(`${now}.${body}`, "utf8").digest("hex")}`;
    expect(verifyChertSignature(body, { "x-chert-signature": legacy }, "s", { nowSeconds: now })).toBe(true);
  });

  it.each([
    [{}, "no header"],
    [{ "X-Webhook-Signature": "garbage" }, "bad format"],
    [{ "x-chert-signature": "v1,abc,def" }, "bad legacy format"],
  ])("rejects %j (%s)", (headers) => {
    expect(verifyChertSignature(body, headers, "s", { nowSeconds: now })).toBe(false);
  });

  it("rejects stale timestamps and bad signatures", () => {
    const stale = sign(body, "s", now - 600);
    expect(verifyChertSignature(body, { "X-Webhook-Signature": stale }, "s", { nowSeconds: now })).toBe(false);
    const wrong = sign(body, "other", now);
    expect(verifyChertSignature(body, { "X-Webhook-Signature": wrong }, "s", { nowSeconds: now })).toBe(false);
  });

  it("returns false when a malformed secret throws", () => {
    expect(verifyChertSignature(body, { "X-Webhook-Signature": sign(body, "s", now) }, 5 as never, { nowSeconds: now })).toBe(false);
  });
});

describe("handleChertWebhook gaps", () => {
  const ok = (body: string) => ({ "X-Webhook-Signature": sign(body, "s", 100) });
  const opts = { secret: "s", inbound: inboundDeps(), nowSeconds: 100 };

  it("rejects malformed JSON and schema-invalid payloads", async () => {
    expect(await handleChertWebhook({ rawBody: "{bad", headers: ok("{bad") }, opts))
      .toMatchObject({ status: 400, body: { error: "invalidJson" } });
    const badShape = JSON.stringify({ event_type: "message.received", data: {} });
    expect(await handleChertWebhook({ rawBody: badShape, headers: ok(badShape) }, opts))
      .toMatchObject({ status: 400, body: { error: "invalidPayload" } });
  });

  it("ignores non-message events and group/outbound messages", async () => {
    const ping = JSON.stringify({ event_type: "message.delivered" });
    expect(await handleChertWebhook({ rawBody: ping, headers: ok(ping) }, opts))
      .toMatchObject({ status: 200, body: { outcome: "ignored" } });
    const group = JSON.stringify({
      event_id: "e1",
      created_at: "2025-01-01T00:00:00Z",
      event_type: "message.received",
      data: {
        chat: { is_group: true },
        message: { direction: "inbound", sender_handle: { handle: "+1" }, parts: [{ type: "text", value: "hi" }] },
      },
    });
    expect(normalizeChertEvent(JSON.parse(group))).toBeNull();
    expect(await handleChertWebhook({ rawBody: group, headers: ok(group) }, opts))
      .toMatchObject({ status: 200, body: { outcome: "ignored" } });
  });
});

describe("createChertWebhookRoute", () => {
  const env = {
    CHERT_WEBHOOK_SECRET: "s",
    CHERT_API_KEY: "k",
    CHERT_PROJECT_ID: "p",
    CHERT_LINE_ID: "l",
    POSTGRES_URL: "postgres://x",
  };

  const post = (body: string, signature?: string) =>
    new Request("http://api/hook", {
      method: "POST",
      body,
      headers: signature ? { "X-Webhook-Signature": signature } : {},
    });

  it("rejects missing env and bad signatures, using the lazy default sql", async () => {
    expect((await createChertWebhookRoute(() => ({}))(post("{}"))).status).toBe(500);
    const route_ = createChertWebhookRoute(() => env);
    expect((await route_(post("{}"))).status).toBe(401);
    const signed = post("not json", sign("not json", "s", Math.floor(Date.now() / 1000)));
    expect((await route_(signed)).status).toBe(400);
  });

  it("maps internal failures to a 500", async () => {
    const route_ = createChertWebhookRoute(() => env, () => { throw new Error("sql gone"); });
    expect((await route_(post("{}"))).status).toBe(500);
  });
});

describe("chert remaining gaps", () => {
  it("rejects a signature with the wrong hex length", () => {
    const now = 1_700_000_000;
    const short = `t=${now},v1=abcd`;
    expect(verifyChertSignature("{}", { "X-Webhook-Signature": short }, "s", { nowSeconds: now })).toBe(false);
  });

  it("propagates a non-Zod store error", async () => {
    const body = JSON.stringify({
      event_id: "e1", created_at: "2025-01-01T00:00:00Z", event_type: "message.received",
      data: { chat: { is_group: false }, message: { direction: "inbound", sender_handle: { handle: "+1" }, parts: [{ type: "text", value: "hi" }] } },
    });
    const inbound = {
      store: { routeInbound: async () => { throw new Error("db"); } },
      provider: "chert",
      resolveSender: async () => ({ ownerId: "o", deviceId: "d" }),
      sendReply: async () => undefined,
    } as never;
    await expect(handleChertWebhook(
      { rawBody: body, headers: { "X-Webhook-Signature": sign(body, "s", 100) } },
      { secret: "s", inbound, nowSeconds: 100 },
    )).rejects.toThrow("db");
  });
});
