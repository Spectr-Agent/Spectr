import { createHmac } from "node:crypto";
import postgres from "postgres";
import { createChertWebhookRoute } from "../src/chert/route.js";
import {
  createMacStepRoute,
  createMacTaskRoute,
  createTaskScreenshotRoute,
} from "../src/agent/routes.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const environment = {
  CHERT_WEBHOOK_SECRET: "route-webhook-secret",
  CHERT_API_KEY: "route-api-key",
  CHERT_PROJECT_ID: "route-project-id",
  CHERT_LINE_ID: "route-line-id",
  POSTGRES_URL: "postgres://route-user:route-password@localhost/route-db",
};

function fakeSql(rows: unknown[] = []): postgres.Sql {
  const query = vi.fn(async () => rows);
  let sqlLike: unknown;
  sqlLike = Object.assign(query, {
    json: vi.fn((value: unknown) => value),
    begin: vi.fn(async (callback: (tx: unknown) => unknown) =>
      callback(sqlLike),
    ),
  });
  return sqlLike as unknown as postgres.Sql;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createChertWebhookRoute", () => {
  it("reports missing environment names without exposing configured values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const makeSql = vi.fn(() => {
      throw new Error("SQL client should not be created");
    });
    const handler = createChertWebhookRoute(
      () => ({
        CHERT_WEBHOOK_SECRET: environment.CHERT_WEBHOOK_SECRET,
        CHERT_API_KEY: environment.CHERT_API_KEY,
        POSTGRES_URL: environment.POSTGRES_URL,
      }),
      makeSql,
    );

    const response = await handler(
      new Request("https://example.test/api/chert/webhook", {
        method: "POST",
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(500);
    expect(responseText).toContain("misconfigured");
    expect(responseText).not.toContain(environment.CHERT_WEBHOOK_SECRET);
    expect(responseText).not.toContain(environment.CHERT_API_KEY);
    expect(responseText).not.toContain(environment.POSTGRES_URL);
    expect(makeSql).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "CHERT_PROJECT_ID, CHERT_LINE_ID",
    );
    expect(log.mock.calls.flat().join(" ")).not.toContain(
      environment.CHERT_API_KEY,
    );
  });

  it("rejects a bad signature without querying Postgres", async () => {
    const query = vi.fn(() => {
      throw new Error("database queried before signature verification");
    });
    const fakeSql = Object.assign(query, { json: vi.fn() }) as unknown as postgres.Sql;
    const makeSql = vi.fn(() => fakeSql);
    const handler = createChertWebhookRoute(() => environment, makeSql);

    const response = await handler(
      new Request("https://example.test/api/chert/webhook", {
        method: "POST",
        headers: { "X-Webhook-Signature": "invalid" },
        body: "{}",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body).toEqual({ ok: false, error: "invalidSignature" });
    expect(makeSql).toHaveBeenCalledTimes(1);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("Mac and screenshot routes", () => {
  it("returns missing environment names without exposing configured secrets", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const makeSql = vi.fn(() => {
      throw new Error("SQL client should not be created");
    });
    const handler = createMacStepRoute(
      () => ({
        POSTGRES_URL: environment.POSTGRES_URL,
        SPECTR_LINK_SECRET: "link-secret-value",
        SENDBLUE_API_KEY_ID: "sendblue-key-id",
        SENDBLUE_API_SECRET_KEY: "sendblue-secret-value",
        SENDBLUE_FROM_NUMBER: "+15555550199",
      }),
      makeSql,
    );
    const response = await handler(
      new Request("https://example.test/api/mac/step", { method: "POST" }),
    );
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(body).toContain("misconfigured");
    expect(body).toContain("ANTHROPIC_API_KEY");
    expect(body).not.toContain(environment.POSTGRES_URL);
    expect(body).not.toContain("link-secret-value");
    expect(body).not.toContain("sendblue-secret-value");
    expect(makeSql).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("ANTHROPIC_API_KEY");
  });

  it("authenticates a Mac token before returning its active-task response", async () => {
    const fake = fakeSql();
    const makeSql = vi.fn(() => fake);
    const handler = createMacTaskRoute(
      () => ({ POSTGRES_URL: environment.POSTGRES_URL }),
      makeSql,
    );
    const missingToken = await handler(
      new Request("https://example.test/api/mac/task"),
    );
    expect(missingToken.status).toBe(401);
    expect(makeSql).not.toHaveBeenCalled();

    const response = await handler(
      new Request("https://example.test/api/mac/task", {
        headers: { authorization: "Bearer unknown-device-token" },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("forbidden");
    expect(makeSql).toHaveBeenCalledTimes(1);
    expect(fake).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid screenshot signature without querying Postgres", async () => {
    const makeSql = vi.fn(() => {
      throw new Error("SQL client should not be created");
    });
    const handler = createTaskScreenshotRoute(
      () => ({
        POSTGRES_URL: environment.POSTGRES_URL,
        SPECTR_LINK_SECRET: "screenshot-secret",
      }),
      makeSql,
    );
    const response = await handler(
      new Request(
        "https://example.test/api/tasks/screenshot?task=tsk_demo_001&sig=00",
      ),
    );

    expect(response.status).toBe(404);
    expect(makeSql).not.toHaveBeenCalled();
  });

  it("serves final screenshot bytes when the task signature is valid", async () => {
    const secret = "screenshot-secret";
    const taskId = "tsk_demo_001";
    const signature = createHmac("sha256", secret).update(taskId).digest("hex");
    const row = {
      id: taskId,
      owner_id: "owner_demo_001",
      device_id: "dev_demo_mac",
      state: "succeeded",
      revision: 1,
      instruction: "Open Instagram",
      question: null,
      reply_provider: "sendblue",
      reply_handle: "+15555550100",
      agent_messages: [],
      pending_tool_results: [],
      step_count: 1,
      last_step_response: {
        kind: "finished",
        taskId,
        step: 1,
        state: "succeeded",
        summary: "The page is open.",
      },
      screen_width: 1920,
      screen_height: 1080,
      summary: "The page is open.",
      final_screenshot: Buffer.from("image-bytes"),
      final_screenshot_type: "image/png",
      result_sent_at: null,
      updated_at: new Date(),
    };
    const fake = fakeSql([row]);
    const handler = createTaskScreenshotRoute(
      () => ({
        POSTGRES_URL: environment.POSTGRES_URL,
        SPECTR_LINK_SECRET: secret,
      }),
      () => fake,
    );
    const response = await handler(
      new Request(
        `https://example.test/api/tasks/screenshot?task=${taskId}&sig=${signature}`,
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from("image-bytes"),
    );
  });
});
