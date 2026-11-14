import postgres from "postgres";
import { createChertWebhookRoute } from "../src/chert/route.js";
import { afterEach, describe, expect, it, vi } from "vitest";

const environment = {
  CHERT_WEBHOOK_SECRET: "route-webhook-secret",
  CHERT_API_KEY: "route-api-key",
  CHERT_PROJECT_ID: "route-project-id",
  CHERT_LINE_ID: "route-line-id",
  POSTGRES_URL: "postgres://route-user:route-password@localhost/route-db",
};

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
