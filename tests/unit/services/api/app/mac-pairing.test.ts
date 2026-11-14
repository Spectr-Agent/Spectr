import { describe, expect, it } from "vitest";
import {
  createMacPairingDispatcher,
  createMacPairingRoutes,
} from "../../../../../services/api/src/app/mac-pairing.js";
import type { AppStore } from "../../../../../services/api/src/app/store.js";

const env = { POSTGRES_URL: "postgres://x", SPECTR_LINK_SECRET: "seal" };

function make(store: Partial<AppStore> = {}, getEnv = () => env) {
  const appStore: AppStore = {
    macs: async () => [],
    phones: async () => [],
    pendingPhone: async () => null,
    task: async () => null,
    recentTasks: async () => [],
    startPairing: async () => ({ pairingId: "pair_1", code: "CODE12", expiresAt: "2030" }),
    pollPairing: async () => ({ status: "pending", expiresAt: "2030" }),
    approvePairing: async () => ({ status: "notFound" }),
    requestPhoneLink: async () => ({ status: "pending", expiresAt: "x" }),
    unlinkPhone: async () => undefined,
    ...store,
  };
  return createMacPairingRoutes(getEnv, () => ({} as never), { makeAppStore: () => appStore });
}

const post = (body: string, path = "/api/mac/pair") =>
  new Request(`http://api${path}`, { method: "POST", body, headers: { "content-type": "application/json" } });

const statusBody = JSON.stringify({ pairingId: "pair_123e4567-e89b-42d3-a456-426614174000", pollSecret: "s".repeat(24) });

describe("mac pairing routes", () => {
  it("creates a pairing for a named Mac", async () => {
    const { start } = make();
    const response = await start(post(JSON.stringify({ name: "Mini" })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: "CODE12" });
    expect((await start(post("{}"))).status).toBe(400);
  });

  it("reports missing env and store failures", async () => {
    const { start } = make({}, () => ({}));
    expect((await start(post(JSON.stringify({ name: "x" }))))).toHaveProperty("status", 500);
    const failing = make({ startPairing: async () => { throw new Error("db"); } });
    expect((await failing.start(post(JSON.stringify({ name: "x" }))))).toHaveProperty("status", 500);
  });

  it("polls pending, paired once, and expired", async () => {
    const { status } = make();
    expect((await status(post(statusBody, "/api/mac/pair-status"))).status).toBe(200);
    const paired = make({ pollPairing: async () => ({ status: "paired", deviceId: "d", deviceToken: "tok" }) });
    expect(await (await paired.status(post(statusBody))).json()).toMatchObject({ status: "paired", deviceToken: "tok" });
    const expired = make({ pollPairing: async () => ({ status: "expired" }) });
    expect((await expired.status(post(statusBody))).status).toBe(410);
    expect((await status(post("{}"))).status).toBe(400);
    const failing = make({ pollPairing: async () => { throw new Error("db"); } });
    expect((await failing.status(post(statusBody))).status).toBe(500);
  });

  it("dispatches pair-status by path or ?status", async () => {
    // No store overrides: an invalid body still proves which handler ran (400 vs 400),
    // and a valid status body reaches the (broken) store -> 500, while start -> 400.
    const dispatch = createMacPairingDispatcher(() => env, () => ({} as never));
    expect((await dispatch(post(statusBody, "/api/mac/pair-status"))).status).toBe(500);
    expect((await dispatch(post(statusBody, "/api/mac/pair?status=1"))).status).toBe(500);
    expect((await dispatch(post(statusBody))).status).toBe(400); // start schema rejects it
  });
});

describe("default sql seam", () => {
  it("uses the lazy postgres client, which fails without a database", async () => {
    const { start } = createMacPairingRoutes(() => env);
    const response = await start(new Request("http://x", { method: "POST", body: JSON.stringify({ name: "mac" }) }));
    expect(response.status).toBe(500);
  }, 20_000);
});
