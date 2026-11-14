import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createChertReplier } from "../src/chert/client.js";
import {
  ChertMessageReceivedSchema,
  normalizeChertEvent,
} from "../src/chert/normalize.js";
import { handleChertWebhook } from "../src/chert/webhook.js";
import { verifyChertSignature } from "../src/chert/verify.js";
import { InMemoryTaskStore } from "../src/memory-store.js";
import type { InboundDeps } from "../src/inbound.js";
import { describe, expect, it, vi } from "vitest";

const secret = "chert-webhook-test-secret";
const nowSeconds = 1_800_000_000;

function readFixture(): unknown {
  return JSON.parse(
    readFileSync(
      new URL("./fixtures/chert-message-received.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
}

function signedHeader(
  rawBody: string,
  timestamp = nowSeconds,
  signingSecret = secret,
): string {
  const signature = createHmac("sha256", signingSecret)
    .update(`${timestamp}.${rawBody}`, "utf8")
    .digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

function makeInboundHarness(sender: { ownerId: string; deviceId: string } | null =
  {
    ownerId: "owner_demo_001",
    deviceId: "dev_demo_mac",
  },
) {
  const store = new InMemoryTaskStore();
  const sendReply = vi.fn(
    async (_toNumber: string, _text: string, _idempotencyKey: string) => {},
  );
  const resolveSender = vi.fn(async (_fromNumber: string) => sender);
  const inbound: InboundDeps = {
    store,
    provider: "chert",
    sendReply,
    resolveSender,
  };
  return { store, sendReply, resolveSender, inbound };
}

describe("verifyChertSignature", () => {
  it("accepts the new signature header case-insensitively", () => {
    const rawBody = JSON.stringify(readFixture());
    const signature = signedHeader(rawBody);

    expect(
      verifyChertSignature(
        rawBody,
        { "x-webhook-signature": signature },
        secret,
        { nowSeconds },
      ),
    ).toBe(true);
  });

  it("accepts the legacy signature header", () => {
    const rawBody = JSON.stringify(readFixture());
    const signature = signedHeader(rawBody);
    const [, timestamp, digest] = /^t=(\d+),v1=(.+)$/.exec(signature)!;

    expect(
      verifyChertSignature(
        rawBody,
        { "X-Chert-Signature": `v1,${timestamp},${digest}` },
        secret,
        { nowSeconds },
      ),
    ).toBe(true);
  });

  it("rejects a tampered body and a wrong secret", () => {
    const rawBody = JSON.stringify(readFixture());
    const headers = { "X-Webhook-Signature": signedHeader(rawBody) };

    expect(
      verifyChertSignature(`${rawBody} `, headers, secret, { nowSeconds }),
    ).toBe(false);
    expect(
      verifyChertSignature(rawBody, headers, "wrong-secret", { nowSeconds }),
    ).toBe(false);
  });

  it("rejects signatures outside the default timestamp tolerance", () => {
    const rawBody = JSON.stringify(readFixture());
    const timestamp = nowSeconds - 301;

    expect(
      verifyChertSignature(
        rawBody,
        { "X-Webhook-Signature": signedHeader(rawBody, timestamp) },
        secret,
        { nowSeconds },
      ),
    ).toBe(false);
  });

  it("rejects a missing or malformed signature header", () => {
    const rawBody = JSON.stringify(readFixture());

    expect(verifyChertSignature(rawBody, {}, secret, { nowSeconds })).toBe(
      false,
    );
    expect(
      verifyChertSignature(
        rawBody,
        { "X-Webhook-Signature": "t=bad,v1=not-a-signature" },
        secret,
        { nowSeconds },
      ),
    ).toBe(false);
  });
});

describe("normalizeChertEvent", () => {
  it("normalizes a message.received fixture", () => {
    expect(normalizeChertEvent(readFixture())).toEqual({
      providerMessageId: "chert:msg:demo_001",
      fromNumber: "+15555550100",
      text: "open the demo deck",
      receivedAt: "2026-05-24T01:35:34.000Z",
    });
  });

  it("ignores outbound messages, group chats, media-only messages, and other events", () => {
    const outbound = ChertMessageReceivedSchema.parse(readFixture());
    outbound.data.message.direction = "outbound";
    expect(normalizeChertEvent(outbound)).toBeNull();

    const group = ChertMessageReceivedSchema.parse(readFixture());
    group.data.chat.is_group = true;
    expect(normalizeChertEvent(group)).toBeNull();

    const mediaOnly = ChertMessageReceivedSchema.parse(readFixture());
    mediaOnly.data.message.parts = [{ type: "media" }];
    expect(normalizeChertEvent(mediaOnly)).toBeNull();

    expect(normalizeChertEvent({ event_type: "message.delivered" })).toBeNull();
  });

  it("joins non-empty text parts with newlines", () => {
    const event = ChertMessageReceivedSchema.parse(readFixture());
    event.data.message.parts = [
      { type: "text", value: "open the" },
      { type: "media" },
      { type: "text", value: "demo deck" },
      { type: "text", value: "   " },
    ];

    expect(normalizeChertEvent(event)?.text).toBe("open the\ndemo deck");
  });
});

describe("handleChertWebhook", () => {
  it("deduplicates a signed delivery and sends one reply", async () => {
    const harness = makeInboundHarness();
    const rawBody = JSON.stringify(readFixture());
    const req = {
      rawBody,
      headers: { "X-Webhook-Signature": signedHeader(rawBody) },
    };
    const deps = { secret, inbound: harness.inbound, nowSeconds };

    const first = await handleChertWebhook(req, deps);
    const second = await handleChertWebhook(req, deps);

    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("created");
    expect(first.body.taskId).toBeTruthy();
    expect(second).toEqual({
      status: 200,
      body: {
        ok: true,
        outcome: "duplicate",
        taskId: first.body.taskId,
      },
    });
    expect(harness.store.tasks.size).toBe(1);
    expect(harness.sendReply).toHaveBeenCalledTimes(1);
    expect(harness.sendReply).toHaveBeenCalledWith(
      "+15555550100",
      "bet, on it",
      "reply-chert:msg:demo_001",
    );
  });

  it("rejects a bad signature without store or reply calls", async () => {
    const harness = makeInboundHarness();
    const response = await handleChertWebhook(
      {
        rawBody: JSON.stringify(readFixture()),
        headers: { "X-Webhook-Signature": "invalid" },
      },
      { secret, inbound: harness.inbound, nowSeconds },
    );

    expect(response).toEqual({
      status: 401,
      body: { ok: false, error: "invalidSignature" },
    });
    expect(harness.store.tasks.size).toBe(0);
    expect(harness.resolveSender).not.toHaveBeenCalled();
    expect(harness.sendReply).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON and structurally invalid messages", async () => {
    const harness = makeInboundHarness();
    const invalidJson = "{";
    const invalidPayload = JSON.stringify({
      event_type: "message.received",
    });

    const invalidJsonResponse = await handleChertWebhook(
      {
        rawBody: invalidJson,
        headers: {
          "X-Webhook-Signature": signedHeader(invalidJson),
        },
      },
      { secret, inbound: harness.inbound, nowSeconds },
    );
    const invalidPayloadResponse = await handleChertWebhook(
      {
        rawBody: invalidPayload,
        headers: {
          "X-Webhook-Signature": signedHeader(invalidPayload),
        },
      },
      { secret, inbound: harness.inbound, nowSeconds },
    );

    expect(invalidJsonResponse.status).toBe(400);
    expect(invalidPayloadResponse.status).toBe(400);
    expect(harness.store.tasks.size).toBe(0);
    expect(harness.sendReply).not.toHaveBeenCalled();
  });

  it("ignores an unknown sender without replying", async () => {
    const harness = makeInboundHarness(null);
    const rawBody = JSON.stringify(readFixture());
    const response = await handleChertWebhook(
      {
        rawBody,
        headers: { "X-Webhook-Signature": signedHeader(rawBody) },
      },
      { secret, inbound: harness.inbound, nowSeconds },
    );

    expect(response).toEqual({
      status: 200,
      body: { ok: true, outcome: "ignored" },
    });
    expect(harness.store.tasks.size).toBe(0);
    expect(harness.sendReply).not.toHaveBeenCalled();
  });
});

describe("createChertReplier", () => {
  it("sends an idempotent shared-line message with the expected request", async () => {
    let requestUrl: RequestInfo | URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = input;
        requestInit = init;
        return new Response(null, { status: 204 });
      },
    );
    const replier = createChertReplier({
      apiKey: "chert-api-secret",
      projectId: "project-demo",
      lineId: "line-demo",
      baseUrl: "https://chert.example/api/v1/",
      fetch: fetchMock,
    });

    await replier(
      "+15555550100",
      "bet, on it",
      "reply-tsk_demo_001",
    );

    expect(requestUrl).toBe("https://chert.example/api/v1/shared-messages");
    expect(requestInit?.method).toBe("POST");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("Authorization")).toBe("Bearer chert-api-secret");
    expect(headers.get("X-Chert-Project-Id")).toBe("project-demo");
    expect(headers.get("Idempotency-Key")).toBe("reply-tsk_demo_001");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      line_id: "line-demo",
      recipient: "+15555550100",
      text: "bet, on it",
    });
  });

  it("includes a non-2xx status without exposing the API key", async () => {
    const apiKey = "chert-api-secret";
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 503 }),
    );
    const replier = createChertReplier({
      apiKey,
      projectId: "project-demo",
      lineId: "line-demo",
      fetch: fetchMock,
    });

    const error = await replier(
      "+15555550100",
      "hello",
      "reply-tsk_demo_001",
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 503");
    expect((error as Error).message).not.toContain(apiKey);
  });
});
