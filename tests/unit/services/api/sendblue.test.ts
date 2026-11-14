import { describe, expect, it, vi } from "vitest";
import { createSendblueReplier } from "../../../../services/api/src/sendblue/client.js";
import { createSendblueWebhookRoute } from "../../../../services/api/src/sendblue/route.js";
import { handleSendblueWebhook } from "../../../../services/api/src/sendblue/webhook.js";
import { verifySendblueSecret } from "../../../../services/api/src/sendblue/verify.js";
import type { InboundDeps } from "../../../../services/api/src/inbound.js";

const replier = (fetchImpl: typeof fetch) =>
  createSendblueReplier({ apiKeyId: "id", apiSecretKey: "sec", fromNumber: "+1", fetch: fetchImpl });

const inboundDeps = (over: Partial<InboundDeps> = {}): InboundDeps => ({
  store: { routeInbound: async () => ({ taskId: "t1", kind: "task", created: true }) } as never,
  provider: "sendblue",
  resolveSender: async () => ({ ownerId: "o", deviceId: "d" }),
  sendReply: async () => undefined,
  ...over,
});

describe("createSendblueReplier gaps", () => {
  it("maps a network failure and a non-OK response to errors", async () => {
    await expect(replier((async () => { throw new Error("down"); }) as typeof fetch)("+2", "hi", "k"))
      .rejects.toThrow("Sendblue reply request failed");
    await expect(replier((async () => new Response("x", { status: 500 })) as typeof fetch)("+2", "hi", "k"))
      .rejects.toThrow("HTTP 500");
  });
});

describe("verifySendblueSecret gaps", () => {
  it("rejects missing, blank and wrong secrets", () => {
    expect(verifySendblueSecret({}, "s")).toBe(false);
    expect(verifySendblueSecret({ "sb-signing-secret": "  " }, "s")).toBe(false);
    expect(verifySendblueSecret({ "sb-signing-secret": "x" }, "")).toBe(false);
    expect(verifySendblueSecret({ "sb-signing-secret": "wrong" }, "s")).toBe(false);
    expect(verifySendblueSecret({ "SB-Signing-Secret": "s" }, "s")).toBe(true);
  });
});

describe("handleSendblueWebhook gaps", () => {
  const headers = { "sb-signing-secret": "s" };

  it("rejects malformed JSON and schema-invalid payloads", async () => {
    expect(await handleSendblueWebhook({ rawBody: "{bad", headers }, { secret: "s", inbound: inboundDeps() }))
      .toMatchObject({ status: 400, body: { error: "invalidJson" } });
    expect(await handleSendblueWebhook({ rawBody: JSON.stringify({ nonsense: 1 }), headers }, { secret: "s", inbound: inboundDeps() }))
      .toMatchObject({ status: 400, body: { error: "invalidPayload" } });
  });

  it("ignores non-message events", async () => {
    const result = await handleSendblueWebhook(
      { rawBody: JSON.stringify({ content: "x", is_outbound: true, status: "RECEIVED", date_sent: "2025-01-01T00:00:00Z" }), headers },
      { secret: "s", inbound: inboundDeps() },
    );
    expect(result).toMatchObject({ status: 200, body: { outcome: "ignored" } });
  });
});

describe("createSendblueWebhookRoute", () => {
  const env = {
    SENDBLUE_API_KEY_ID: "id",
    SENDBLUE_API_SECRET_KEY: "sec",
    SENDBLUE_FROM_NUMBER: "+1",
    SENDBLUE_WEBHOOK_SECRET: "s",
    POSTGRES_URL: "postgres://x",
  };

  const post = (body: string, secret = "s") =>
    new Request("http://api/hook", { method: "POST", body, headers: { "sb-signing-secret": secret } });

  it("rejects missing env and bad signatures, using the lazy default sql", async () => {
    expect((await createSendblueWebhookRoute(() => ({}))(post("{}"))).status).toBe(500);
    // Default makeSql runs postgres() lazily; the bad signature short-circuits before any query.
    const route_ = createSendblueWebhookRoute(() => env);
    expect((await route_(post("{}", "wrong"))).status).toBe(401);
    const good = await route_(post("not json"));
    expect(good.status).toBe(400);
  });

  it("maps internal failures to a 500", async () => {
    const route_ = createSendblueWebhookRoute(() => env, () => { throw new Error("sql gone"); });
    expect((await route_(post("{}"))).status).toBe(500);
  });
});

describe("handleSendblueWebhook unexpected failures", () => {
  it("propagates a non-Zod store error", async () => {
    const payload = JSON.stringify({
      content: "hi", is_outbound: false, message_handle: "h1", from_number: "+15555550100", status: "RECEIVED", date_sent: "2025-01-01T00:00:00Z",
    });
    const inbound = inboundDeps({
      store: { routeInbound: async () => { throw new Error("db"); } } as never,
    });
    await expect(handleSendblueWebhook(
      { rawBody: payload, headers: { "sb-signing-secret": "s" } },
      { secret: "s", inbound },
    )).rejects.toThrow("db");
  });
});

describe("createSendblueReplier unreadable body", () => {
  it("returns quietly when the success body is not JSON", async () => {
    const fetchImpl = async () => ({ ok: true, json: async () => { throw new Error("not json"); } });
    await expect(replier(fetchImpl as unknown as typeof fetch)("+2", "hi", "k")).resolves.toBeUndefined();
  });
});
