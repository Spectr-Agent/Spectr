import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import {
  InMemoryOnboardingStore,
} from "../../../../../services/api/src/agent/onboarding/store.js";
import {
  newPairingCode,
  normalizeCode,
  openToken,
  PostgresAppStore,
  sealToken,
} from "../../../../../services/api/src/app/store.js";
import { emptyProfile } from "../../../../../services/api/src/agent/onboarding/profile.js";

/** A postgres.Sql stand-in that answers queries by matching the SQL text. */
function fakeSql(handlers: Array<[match: RegExp, rows: unknown[] | (() => unknown[])]>) {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    queries.push(text);
    for (const [match, rows] of handlers) {
      if (match.test(text)) return Promise.resolve(typeof rows === "function" ? rows() : rows);
    }
    return Promise.resolve([]);
  }) as unknown as postgres.Sql;
  sql.begin = (cb: (tx: postgres.Sql) => unknown) => Promise.resolve(cb(sql)) as never;
  return { sql, queries };
}

const secret = "seal-secret";

describe("pairing helpers", () => {
  it("generates codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(newPairingCode()).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/u);
    }
  });

  it.each([
    ["k7p 4qx", "K7P4QX"],
    ["k7p-4qx", "K7P4QX"],
    ["ab-cd_ef", "ABCDEF"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeCode(input)).toBe(expected);
  });

  it("seals and opens a device token with the same secret", () => {
    const sealed = sealToken("spd_token", secret);
    expect(openToken(sealed, secret)).toBe("spd_token");
  });

  it("rejects a malformed seal and the wrong secret", () => {
    expect(() => openToken("not-a-seal", secret)).toThrow("Malformed sealed token");
    expect(() => openToken(sealToken("t", secret), "other")).toThrow();
  });
});

describe("PostgresAppStore", () => {
  const store = (handlers: Array<[RegExp, unknown[] | (() => unknown[])]>) =>
    new PostgresAppStore(fakeSql(handlers).sql, secret);

  it("lists macs, phones and the pending phone", async () => {
    const { sql, queries } = fakeSql([
      [/from public\.devices/u, [{ id: "mac-1", name: "Mini", last_seen_at: null }]],
      [/messaging_identities/u, [{ handle: "+1555" }, { handle: "+1666" }]],
      [/phone_link_requests/u, [{ phone: "+1777", expires_at: "2030-01-01" }]],
    ]);
    const s = new PostgresAppStore(sql, secret);
    expect(await s.macs("owner")).toEqual([{ id: "mac-1", name: "Mini", last_seen_at: null }]);
    expect(await s.phones("owner")).toEqual(["+1555", "+1666"]);
    expect(await s.pendingPhone("owner", new Date())).toEqual({ phone: "+1777", expiresAt: "2030-01-01T00:00:00.000Z" });
    expect(queries).toHaveLength(3);
  });

  it("returns null for pendingPhone and missing tasks", async () => {
    const s = store([]);
    expect(await s.pendingPhone("owner", new Date())).toBeNull();
    expect(await s.task("owner", "tsk_1")).toBeNull();
    expect(await s.recentTasks("owner", 5)).toEqual([]);
  });

  it("reads a chat's tasks and their messages, and nothing for an unknown chat", async () => {
    const task = { id: "tsk_1", session_id: "tsk_1" };
    const message = { task_id: "tsk_1", kind: "task", text: "hi", created_at: "2030-01-01" };
    const { sql, queries } = fakeSql([
      [/from public\.inbound_messages/u, [message]],
      [/session_id = /u, [task]],
    ]);
    const s = new PostgresAppStore(sql, secret);
    expect(await s.session("owner", "tsk_1")).toEqual({ tasks: [task], inbound: [message] });
    expect(queries.some((text) => text.includes("from public.inbound_messages"))).toBe(true);
    expect(await store([]).session("owner", "tsk_x")).toEqual({ tasks: [], inbound: [] });
  });

  it("starts a pairing and retries on code collisions", async () => {
    let inserts = 0;
    const { sql } = fakeSql([[/insert into public\.device_pairings/u, () => (inserts += 1) && [{ id: "pair_1" }]]]);
    const s = new PostgresAppStore(sql, secret);
    const result = await s.startPairing("Mini", new Date("2030-01-01"));
    expect(result.pairingId).toMatch(/^pair_/u);
    expect(result.code).toHaveLength(6);
    expect(result.expiresAt).toBe("2030-01-01T00:10:00.000Z");
    expect(inserts).toBe(1);
  });

  it("fails after five code collisions", async () => {
    const s = store([[/insert into public\.device_pairings/u, []]]);
    await expect(s.startPairing("Mini", new Date())).rejects.toThrow("Could not allocate");
  });

  it("reports expired for an unknown or already-delivered poll", async () => {
    const s = store([
      [/from public\.device_pairings/u, [{ delivered_at: new Date(), expires_at: null, approved_at: null }]],
    ]);
    expect(await s.pollPairing("pair_1", "sec", new Date())).toEqual({ status: "expired" });
    const missing = store([]);
    expect(await missing.pollPairing("pair_1", "sec", new Date())).toEqual({ status: "expired" });
  });

  it("hands the sealed token to the approved poller exactly once", async () => {
    const ciphertext = sealToken("spd_secret", secret);
    const s = store([
      [/from public\.device_pairings/u, [
        { device_id: "mac-9", token_ciphertext: ciphertext, expires_at: null, approved_at: new Date(), delivered_at: null },
      ]],
    ]);
    const result = await s.pollPairing("pair_1", "sec", new Date());
    expect(result).toEqual({ status: "paired", deviceId: "mac-9", deviceToken: "spd_secret" });
  });

  it("reports pending until the code expires", async () => {
    const future = new Date(Date.now() + 60_000);
    const s = store([
      [/from public\.device_pairings/u, [{ device_id: null, token_ciphertext: null, expires_at: future, approved_at: null, delivered_at: null }]],
    ]);
    expect(await s.pollPairing("pair_1", "sec", new Date())).toEqual({ status: "pending", expiresAt: future.toISOString() });
    const past = store([
      [/from public\.device_pairings/u, [{ device_id: null, token_ciphertext: null, expires_at: new Date(0), approved_at: null, delivered_at: null }]],
    ]);
    expect(await past.pollPairing("pair_1", "sec", new Date())).toEqual({ status: "expired" });
  });

  it("approves a matching code or reports notFound", async () => {
    const s = store([[/from public\.device_pairings/u, [{ id: "pair_1", mac_name: "Mini" }]]]);
    const result = await s.approvePairing("owner", "k7p-4qx", new Date());
    expect(result).toMatchObject({ status: "paired", name: "Mini" });
    const none = store([]);
    expect(await none.approvePairing("owner", "code", new Date())).toEqual({ status: "notFound" });
  });

  it("links a phone, detects taken and pending", async () => {
    const linked = store([[/messaging_identities/u, [{ owner_id: "owner" }]]]);
    expect(await linked.requestPhoneLink("owner", "+1", new Date())).toEqual({ status: "linked" });
    const taken = store([[/messaging_identities/u, [{ owner_id: "other" }]]]);
    expect(await taken.requestPhoneLink("owner", "+1", new Date())).toEqual({ status: "taken" });
    const pending = store([]);
    const result = await pending.requestPhoneLink("owner", "+1", new Date("2030-01-01"));
    expect(result).toEqual({ status: "pending", expiresAt: "2030-01-01T00:15:00.000Z" });
  });

  it("unlinks a phone from both tables", async () => {
    const { sql, queries } = fakeSql([]);
    await new PostgresAppStore(sql, secret).unlinkPhone("owner", "+1");
    expect(queries).toHaveLength(2);
  });
});

describe("InMemoryOnboardingStore", () => {
  it("round-trips state and profiles defensively", async () => {
    const store = new InMemoryOnboardingStore();
    expect(await store.getState("id")).toBeNull();
    const profile = emptyProfile();
    const state = { step: "confirming", draft: profile } as const;
    await store.putState("id", state);
    expect(await store.getState("id")).toEqual(state);
    await store.deleteState("id");
    expect(await store.getState("id")).toBeNull();

    expect(await store.getProfile("id")).toBeNull();
    await store.saveProfile("id", profile);
    expect(await store.getProfile("id")).toEqual(profile);
    await store.deleteProfile("id");
    expect(await store.getProfile("id")).toBeNull();
  });
});
