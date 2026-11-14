import { readFileSync } from "node:fs";
import postgres from "postgres";
import { ZodError } from "zod";
import { createSendblueReplier } from "../src/sendblue/client.js";
import { normalizeSendblueMessage } from "../src/sendblue/normalize.js";
import { createSendblueWebhookRoute } from "../src/sendblue/route.js";
import { handleSendblueWebhook } from "../src/sendblue/webhook.js";
import {
  SENDBLUE_SIGNING_SECRET_HEADER,
  verifySendblueSecret,
} from "../src/sendblue/verify.js";
import { InMemoryTaskStore } from "../src/memory-store.js";
import type { InboundDeps } from "../src/inbound.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const secret = "sendblue-webhook-test-secret";

function readFixture(): Record<string, unknown> {
  return JSON.parse(
    readFileSync(
      new URL("./fixtures/sendblue-message-received.json", import.meta.url),
      "utf8",
    ),
  ) as Record<string, unknown>;
}

function makeInboundHarness(
  sender: { ownerId: string; deviceId: string } | null = {
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
    provider: "sendblue",
    sendReply,
    resolveSender,
  };
  return { store, sendReply, resolveSender, inbound };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifySendblueSecret", () => {
  it("accepts the configured secret case-insensitively", () => {
    expect(SENDBLUE_SIGNING_SECRET_HEADER).toBe("sb-signing-secret");
    expect(
      verifySendblueSecret({ "SB-SIGNING-SECRET": secret }, secret),
    ).toBe(true);
  });

  it("rejects wrong, missing, and empty secrets", () => {
    expect(
      verifySendblueSecret(
        { [SENDBLUE_SIGNING_SECRET_HEADER]: "wrong-secret" },
        secret,
      ),
    ).toBe(false);
    expect(verifySendblueSecret({}, secret)).toBe(false);
    expect(
      verifySendblueSecret(
        { [SENDBLUE_SIGNING_SECRET_HEADER]: "" },
        secret,
      ),
    ).toBe(false);
    expect(
      verifySendblueSecret(
        { [SENDBLUE_SIGNING_SECRET_HEADER]: secret },
        "",
      ),
    ).toBe(false);
  });
});

describe("normalizeSendblueMessage", () => {
  it("normalizes the received-message fixture", () => {
    expect(normalizeSendblueMessage(readFixture())).toEqual({
      providerMessageId: "99DCC379-DD76-4712-BA65-11EFB33B8CD6",
      fromNumber: "+15555550100",
      text: "open the demo deck",
      receivedAt: "2025-12-12T15:41:20.932Z",
    });
  });

  it("ignores outbound, grouped, and non-received messages", () => {
    const fixture = readFixture();

    expect(
      normalizeSendblueMessage({ ...fixture, is_outbound: true }),
    ).toBeNull();
    expect(
      normalizeSendblueMessage({ ...fixture, group_id: "group-demo" }),
    ).toBeNull();
    expect(normalizeSendblueMessage({ ...fixture, status: "SENT" })).toBeNull();
  });

  it("ignores media-only and whitespace-only content", () => {
    const fixture = readFixture();

    expect(
      normalizeSendblueMessage({
        ...fixture,
        content: "",
        media_url: "https://example.invalid/image.jpg",
      }),
    ).toBeNull();
    expect(
      normalizeSendblueMessage({ ...fixture, content: "  \n " }),
    ).toBeNull();
  });

  it("preserves Apple-ID sender addresses and rejects a missing message handle", () => {
    const fixture = readFixture();
    expect(
      normalizeSendblueMessage({
        ...fixture,
        from_number: "demo@example.invalid",
      })?.fromNumber,
    ).toBe("demo@example.invalid");

    delete fixture.message_handle;
    expect(() => normalizeSendblueMessage(fixture)).toThrow(ZodError);

    const missingSender = readFixture();
    delete missingSender.from_number;
    expect(() => normalizeSendblueMessage(missingSender)).toThrow(ZodError);
  });
});

describe("handleSendblueWebhook", () => {
  it("rejects a bad secret without calling the store", async () => {
    const harness = makeInboundHarness();
    const routeInbound = vi.spyOn(harness.store, "routeInbound");
    const response = await handleSendblueWebhook(
      {
        rawBody: JSON.stringify(readFixture()),
        headers: { [SENDBLUE_SIGNING_SECRET_HEADER]: "wrong-secret" },
      },
      { secret, inbound: harness.inbound },
    );

    expect(response).toEqual({
      status: 401,
      body: { ok: false, error: "invalidSignature" },
    });
    expect(routeInbound).not.toHaveBeenCalled();
    expect(harness.resolveSender).not.toHaveBeenCalled();
    expect(harness.sendReply).not.toHaveBeenCalled();
  });

  it("returns 400 for invalid JSON", async () => {
    const harness = makeInboundHarness();
    const response = await handleSendblueWebhook(
      {
        rawBody: "{",
        headers: { [SENDBLUE_SIGNING_SECRET_HEADER]: secret },
      },
      { secret, inbound: harness.inbound },
    );

    expect(response).toEqual({
      status: 400,
      body: { ok: false, error: "invalidJson" },
    });
    expect(harness.store.tasks.size).toBe(0);
  });

  it("deduplicates repeated messages and sends one reply", async () => {
    const harness = makeInboundHarness();
    const rawBody = JSON.stringify(readFixture());
    const request = {
      rawBody,
      headers: { [SENDBLUE_SIGNING_SECRET_HEADER]: secret },
    };
    const deps = { secret, inbound: harness.inbound };

    const first = await handleSendblueWebhook(request, deps);
    const second = await handleSendblueWebhook(request, deps);

    expect(first.status).toBe(200);
    expect(first.body.outcome).toBe("created");
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
      `Spectr is on it. Task ${first.body.taskId}.`,
      "reply-99DCC379-DD76-4712-BA65-11EFB33B8CD6",
    );
  });

  it("returns the unknown-sender outcome without replying", async () => {
    const harness = makeInboundHarness(null);
    const rawBody = JSON.stringify(readFixture());
    const response = await handleSendblueWebhook(
      {
        rawBody,
        headers: { [SENDBLUE_SIGNING_SECRET_HEADER]: secret },
      },
      { secret, inbound: harness.inbound },
    );

    expect(response).toEqual({
      status: 200,
      body: { ok: true, outcome: "ignored" },
    });
    expect(harness.store.tasks.size).toBe(0);
    expect(harness.sendReply).not.toHaveBeenCalled();
  });
});

describe("createSendblueReplier", () => {
  it("sends the expected request without an idempotency header", async () => {
    let requestUrl: RequestInfo | URL | undefined;
    let requestInit: RequestInit | undefined;
    const fetchMock = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        requestUrl = input;
        requestInit = init;
        return new Response(JSON.stringify({ status: "OK" }), {
          status: 200,
        });
      },
    );
    const replier = createSendblueReplier({
      apiKeyId: "sendblue-key-id",
      apiSecretKey: "sendblue-secret-key",
      fromNumber: "+15555550199",
      baseUrl: "https://sendblue.example/",
      fetch: fetchMock,
    });

    await replier(
      "+15555550100",
      "Spectr is on it.",
      "reply-tsk_demo_001",
    );

    expect(requestUrl).toBe("https://sendblue.example/api/send-message");
    expect(requestInit?.method).toBe("POST");
    const headers = new Headers(requestInit?.headers);
    expect(headers.get("sb-api-key-id")).toBe("sendblue-key-id");
    expect(headers.get("sb-api-secret-key")).toBe("sendblue-secret-key");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBeNull();
    expect(JSON.parse(requestInit?.body as string)).toEqual({
      number: "+15555550100",
      from_number: "+15555550199",
      content: "Spectr is on it.",
    });
  });

  it("reports non-2xx status without leaking keys or response body", async () => {
    const apiKeyId = "sendblue-key-id";
    const apiSecretKey = "sendblue-secret-key";
    const replier = createSendblueReplier({
      apiKeyId,
      apiSecretKey,
      fromNumber: "+15555550199",
      fetch: async () =>
        new Response(apiSecretKey, { status: 503 }),
    });
    const error = await replier(
      "+15555550100",
      "hello",
      "reply-tsk_demo_001",
    ).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("HTTP 503");
    expect((error as Error).message).not.toContain(apiKeyId);
    expect((error as Error).message).not.toContain(apiSecretKey);
  });

  it("treats a 2xx response with status ERROR as a failed reply", async () => {
    const replier = createSendblueReplier({
      apiKeyId: "sendblue-key-id",
      apiSecretKey: "sendblue-secret-key",
      fromNumber: "+15555550199",
      fetch: async () =>
        new Response(JSON.stringify({ status: "ERROR" }), { status: 200 }),
    });

    await expect(
      replier("+15555550100", "hello", "reply-tsk_demo_001"),
    ).rejects.toThrow("status ERROR");
  });
});

describe("createSendblueWebhookRoute", () => {
  const environment = {
    SENDBLUE_API_KEY_ID: "route-api-key-id",
    SENDBLUE_API_SECRET_KEY: "route-api-secret-key",
    SENDBLUE_FROM_NUMBER: "+15555550199",
    SENDBLUE_WEBHOOK_SECRET: secret,
    POSTGRES_URL: "postgres://route-user:route-password@localhost/route-db",
  };

  it("reports missing environment names without exposing configured values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const makeSql = vi.fn(() => {
      throw new Error("SQL client should not be created");
    });
    const handler = createSendblueWebhookRoute(
      () => ({
        SENDBLUE_API_KEY_ID: environment.SENDBLUE_API_KEY_ID,
        SENDBLUE_API_SECRET_KEY: environment.SENDBLUE_API_SECRET_KEY,
        POSTGRES_URL: environment.POSTGRES_URL,
      }),
      makeSql,
    );

    const response = await handler(
      new Request("https://example.test/api/sendblue/webhook", {
        method: "POST",
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toContain("misconfigured");
    for (const value of Object.values(environment)) {
      expect(responseText).not.toContain(value);
    }
    expect(makeSql).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "SENDBLUE_FROM_NUMBER, SENDBLUE_WEBHOOK_SECRET",
    );
  });

  it("rejects a bad secret without querying Postgres and logs only header names", async () => {
    const query = vi.fn(() => {
      throw new Error("database queried before secret verification");
    });
    const fakeSql = Object.assign(query, { json: vi.fn() }) as unknown as postgres.Sql;
    const makeSql = vi.fn(() => fakeSql);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handler = createSendblueWebhookRoute(
      () => environment,
      makeSql,
    );

    const response = await handler(
      new Request("https://example.test/api/sendblue/webhook", {
        method: "POST",
        headers: {
          [SENDBLUE_SIGNING_SECRET_HEADER]: "wrong-webhook-secret",
        },
        body: "{}",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "invalidSignature" });
    expect(makeSql).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const warning = warn.mock.calls.flat().join(" ");
    expect(warning).toContain(SENDBLUE_SIGNING_SECRET_HEADER);
    expect(warning).not.toContain("wrong-webhook-secret");
    expect(warning).not.toContain(secret);
  });
});
