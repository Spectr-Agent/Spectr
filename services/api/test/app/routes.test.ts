import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import type postgres from "postgres";
import type { TaskStore } from "../../src/inbound.js";
import type { LiveKitRooms } from "../../src/livekit/app-token.js";
import { createAppApi, toE164 } from "../../src/app/routes.js";
import { createMacPairingRoutes } from "../../src/app/mac-pairing.js";
import { normalizeCode, openToken, sealToken, type AppStore, type MacRow } from "../../src/app/store.js";
import { activityFor, chatMessages, isApprovalQuestion, type InboundRow, type TaskRow } from "../../src/app/views.js";

const OWNER = "589aefe5-4901-4118-a761-90f5d86a737f";
const OTHER = "11111111-2222-3333-4444-555555555555";
const NOW = new Date("2026-11-15T12:00:00Z");

const env = {
  POSTGRES_URL: "postgres://unused",
  SUPABASE_URL: "https://project.supabase.test",
  SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
  SPECTR_LINK_SECRET: "link-secret",
  LIVEKIT_URL: "wss://project.livekit.test",
  LIVEKIT_API_KEY: "APItestkey",
  LIVEKIT_API_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
};

function row(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: "tsk_1",
    device_id: "mac-1",
    state: "running",
    revision: 1,
    instruction: "open Notes and write milk",
    question: null,
    summary: null,
    step_count: 2,
    last_step_response: {
      kind: "actions",
      taskId: "tsk_1",
      step: 2,
      revision: 1,
      actions: [
        { actionId: "a1", action: { type: "click", x: 1, y: 1, button: "left", clicks: 1, modifiers: [] } },
        { actionId: "a2", action: { type: "type", text: "milk" } },
      ],
    },
    reply_provider: "app",
    created_at: NOW,
    updated_at: NOW,
    has_screenshot: false,
    ...overrides,
  };
}

class FakeAppStore implements AppStore {
  macRows: Record<string, MacRow[]> = {
    [OWNER]: [{ id: "mac-1", name: "Jared's Mac", last_seen_at: new Date(NOW.getTime() - 5_000) }],
  };
  phoneRows: Record<string, string[]> = { [OWNER]: ["+14706211642"], [OTHER]: ["+15550001111"] };
  taskRows: Record<string, TaskRow[]> = { [OWNER]: [row()] };
  approvals: string[] = [];
  links: string[] = [];
  async macs(ownerId: string) {
    return this.macRows[ownerId] ?? [];
  }
  async phones(ownerId: string) {
    return this.phoneRows[ownerId] ?? [];
  }
  async pendingPhone() {
    return null;
  }
  async recentTasks(ownerId: string) {
    return this.taskRows[ownerId] ?? [];
  }
  async task(ownerId: string, taskId: string) {
    return (this.taskRows[ownerId] ?? []).find((task) => task.id === taskId) ?? null;
  }
  inboundRows: InboundRow[] = [];
  async session(ownerId: string, sessionId: string) {
    const tasks = (this.taskRows[ownerId] ?? []).filter((task) => (task.session_id ?? task.id) === sessionId);
    const ids = new Set(tasks.map((task) => task.id));
    return { tasks, inbound: this.inboundRows.filter((message) => ids.has(message.task_id)) };
  }
  async startPairing() {
    return { pairingId: "pair_x", code: "K7P4QX", pollSecret: "s", expiresAt: NOW.toISOString() };
  }
  async pollPairing() {
    return { status: "expired" } as const;
  }
  async approvePairing(ownerId: string, code: string) {
    if (normalizeCode(code) !== "K7P4QX") return { status: "notFound" } as const;
    this.approvals.push(ownerId);
    return { status: "paired", deviceId: "mac-new", name: "Studio Mac" } as const;
  }
  async requestPhoneLink(ownerId: string, phone: string) {
    const owner = Object.entries(this.phoneRows).find(([, phones]) => phones.includes(phone))?.[0];
    if (owner) return owner === ownerId ? ({ status: "linked" } as const) : ({ status: "taken" } as const);
    this.links.push(phone);
    return { status: "pending", expiresAt: NOW.toISOString() } as const;
  }
  async unlinkPhone(ownerId: string, phone: string) {
    this.phoneRows[ownerId] = (this.phoneRows[ownerId] ?? []).filter((item) => item !== phone);
  }
}

function setup() {
  const appStore = new FakeAppStore();
  const routed: Array<Record<string, unknown>> = [];
  const taskStore = {
    async routeInbound(input: Record<string, unknown>) {
      routed.push(input);
      return { taskId: "tsk_1", kind: input.text === "stop" ? "stop" : "correction", created: true };
    },
  } as unknown as TaskStore;
  const dispatched: string[][] = [];
  const woken: string[] = [];
  const rooms: LiveKitRooms = {
    async dispatchCallAgent(room, agent, identity) {
      dispatched.push([room, agent, identity]);
    },
    async macIsSharing() {
      return true;
    },
  };
  const api = createAppApi(() => env, () => ({}) as postgres.Sql, {
    verifyUser: async (token) =>
      token === "owner-token" ? { userId: OWNER, email: "j@example.test" } : token === "other-token" ? { userId: OTHER, email: null } : null,
    makeAppStore: () => appStore,
    makeTaskStore: () => taskStore,
    rooms,
    wakeMac: async (deviceId) => {
      woken.push(deviceId);
    },
    now: () => NOW,
  });
  return { api, appStore, routed, dispatched, woken };
}

const get = (path: string, token?: string) =>
  new Request(`https://api.test${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
const send = (method: string, path: string, body: unknown, token = "owner-token") =>
  new Request(`https://api.test${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("app routes: authentication", () => {
  it("rejects a missing or unknown session on every route", async () => {
    const { api } = setup();
    for (const handler of Object.values(api)) {
      expect((await handler(get("/api/app/home"))).status).toBe(401);
      expect((await handler(get("/api/app/home", "forged"))).status).toBe(401);
    }
  });

  it("names missing configuration instead of failing silently", async () => {
    const api = createAppApi(() => ({ ...env, SUPABASE_URL: undefined }));
    const response = await api.home(get("/api/app/home", "owner-token"));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("SUPABASE_URL");
  });
});

describe("GET /api/app/home", () => {
  it("returns the owner's Mac, numbers and tasks with live status", async () => {
    const { api } = setup();
    const response = await api.home(get("/api/app/home", "owner-token"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as Record<string, any>;
    expect(body.macs).toEqual([
      { deviceId: "mac-1", name: "Jared's Mac", status: "online", sharing: true, lastSeenAt: "2026-11-15T11:59:55.000Z" },
    ]);
    expect(body.phones).toEqual(["+14706211642"]);
    expect(body.spectrNumber).toBe("+14705969455");
    expect(body.activeTask.taskId).toBe("tsk_1");
    expect(body.activeTask.activity).toBe("Typing “milk”");
  });

  it("shows nothing of another account", async () => {
    const { api } = setup();
    const body = (await (await api.home(get("/api/app/home", "other-token"))).json()) as Record<string, any>;
    expect(body.macs).toEqual([]);
    expect(body.recentTasks).toEqual([]);
    expect(body.phones).toEqual(["+15550001111"]);
  });
});

describe("tasks", () => {
  it("does not reveal another account's task", async () => {
    const { api } = setup();
    expect((await api.task(get("/api/app/task?id=tsk_1", "other-token"))).status).toBe(404);
    expect((await api.task(get("/api/app/task?id=tsk_1", "owner-token"))).status).toBe(200);
  });

  it("wakes the Mac as soon as a message routes", async () => {
    const { api, woken } = setup();
    await api.message(send("POST", "/api/app/message", { text: "open notes", clientMessageId: "c-87654321" }));
    expect(woken).toEqual(["mac-1"]);
  });

  it("routes a message through the shared pipeline with an idempotent id", async () => {
    const { api, routed } = setup();
    const response = await api.message(send("POST", "/api/app/message", { text: "actually write eggs", clientMessageId: "c-12345678" }));
    expect(response.status).toBe(200);
    expect(routed[0]).toMatchObject({
      providerMessageId: `app:${OWNER}:c-12345678`,
      ownerId: OWNER,
      deviceId: "mac-1",
      replyProvider: "app",
      text: "actually write eggs",
    });
  });

  it("asks for a Mac before accepting a task", async () => {
    const { api } = setup();
    const response = await api.message(send("POST", "/api/app/message", { text: "hi", clientMessageId: "c-12345678" }, "other-token"));
    expect(response.status).toBe(409);
    expect(((await response.json()) as any).error.code).toBe("noMac");
  });

  it("rejects an empty message", async () => {
    const { api } = setup();
    expect((await api.message(send("POST", "/api/app/message", { text: "  ", clientMessageId: "c-12345678" }))).status).toBe(400);
  });

  it("stops an active task on its own Mac and leaves a finished one alone", async () => {
    const { api, appStore, routed } = setup();
    await api.stop(send("POST", "/api/app/stop", { taskId: "tsk_1", clientMessageId: "s-12345678" }));
    expect(routed[0]).toMatchObject({ text: "stop", deviceId: "mac-1" });
    appStore.taskRows[OWNER] = [row({ state: "succeeded" })];
    const response = await api.stop(send("POST", "/api/app/stop", { taskId: "tsk_1", clientMessageId: "s-87654321" }));
    expect(response.status).toBe(200);
    expect(routed).toHaveLength(1);
  });
});

describe("chats", () => {
  const earlier = row({
    id: "tsk_0",
    state: "succeeded",
    summary: "Wrote milk in Notes.",
    has_screenshot: true,
    session_id: "tsk_0",
    created_at: new Date(NOW.getTime() - 60_000),
  });
  const resumed = row({ id: "tsk_2", state: "waitingForUser", question: "Which note?", session_id: "tsk_0" });

  it("returns a chat's conversation and hides it from other accounts", async () => {
    const { api, appStore } = setup();
    appStore.taskRows[OWNER] = [earlier, resumed];
    appStore.inboundRows = [
      { task_id: "tsk_0", kind: "task", text: "write milk in Notes", created_at: earlier.created_at },
      { task_id: "tsk_0", kind: "correction", text: "and eggs", created_at: earlier.created_at },
      { task_id: "tsk_2", kind: "task", text: "add bread too", created_at: NOW },
    ];
    const response = await api.session(get("/api/app/session?id=tsk_0", "owner-token"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, any>;
    expect(body.sessionId).toBe("tsk_0");
    expect(body.tasks.map((task: any) => [task.taskId, task.sessionId])).toEqual([
      ["tsk_0", "tsk_0"],
      ["tsk_2", "tsk_0"],
    ]);
    expect(body.messages.map((message: any) => [message.role, message.text])).toEqual([
      ["user", "write milk in Notes"],
      ["user", "and eggs"],
      ["spectr", "Wrote milk in Notes."],
      ["user", "add bread too"],
      ["spectr", "Which note?"],
    ]);
    expect(body.messages[2].screenshotUrl).toContain("tsk_0");
    expect(body.messages[4].screenshotUrl).toBeNull();
    expect((await api.session(get("/api/app/session?id=tsk_0", "other-token"))).status).toBe(404);
    expect((await api.session(get("/api/app/session", "owner-token"))).status).toBe(400);
  });

  it("continues an owned chat and refuses someone else's", async () => {
    const { api, appStore, routed } = setup();
    appStore.taskRows[OWNER] = [earlier];
    const ok = await api.message(
      send("POST", "/api/app/message", { text: "add bread", clientMessageId: "c-22345678", sessionId: "tsk_0" }),
    );
    expect(ok.status).toBe(200);
    expect(routed[0]).toMatchObject({ text: "add bread", sessionId: "tsk_0" });
    const missing = await api.message(
      send("POST", "/api/app/message", { text: "add bread", clientMessageId: "c-32345678", sessionId: "tsk_nope" }),
    );
    expect(missing.status).toBe(404);
    expect(routed).toHaveLength(1);
  });

  it("uses the task's instruction when no message row was kept, and shows nothing for a running task", () => {
    const running = row({ id: "tsk_9" });
    const messages = chatMessages([running], [], () => "https://shot");
    expect(messages).toEqual([
      expect.objectContaining({ role: "user", text: "open Notes and write milk", state: null, screenshotUrl: null }),
    ]);
  });
});

describe("POST /api/app/live", () => {
  const verifier = new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);

  it("gives a watcher subscribe-only access to their own Mac room", async () => {
    const { api, dispatched } = setup();
    const body = (await (await api.live(send("POST", "/api/app/live", { mode: "watch" }))).json()) as Record<string, any>;
    const claims = await verifier.verify(body.token);
    expect(body.room).toBe("spectr-mac-mac-1");
    expect(claims.sub).toMatch(new RegExp(`^watch:${OWNER}:`));
    expect(claims.video?.canSubscribe).toBe(true);
    expect(claims.video?.canPublish).toBe(false);
    expect(claims.video?.canPublishData).toBe(false);
    expect(dispatched).toEqual([]);
  });

  it("lets a caller publish only their microphone and dispatches the call agent", async () => {
    const { api, dispatched } = setup();
    const body = (await (await api.live(send("POST", "/api/app/live", { mode: "call" }))).json()) as Record<string, any>;
    const claims = await verifier.verify(body.token);
    expect(claims.sub).toBe(`user:${OWNER}`);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canPublishSources).toEqual(["microphone"]);
    expect(dispatched).toEqual([["spectr-mac-mac-1", "spectr-call", `user:${OWNER}`]]);
    expect(JSON.stringify(body)).not.toContain(env.LIVEKIT_API_SECRET);
  });

  it("refuses a Mac the user doesn't own", async () => {
    const { api } = setup();
    expect((await api.live(send("POST", "/api/app/live", { mode: "watch", deviceId: "mac-someone-else" }))).status).toBe(409);
  });
});

describe("pairing and numbers", () => {
  it("approves a code typed loosely and refuses a wrong one", async () => {
    const { api, appStore } = setup();
    expect((await api.pair(send("POST", "/api/app/pair", { code: "k7p 4qx" }))).status).toBe(200);
    expect(appStore.approvals).toEqual([OWNER]);
    expect((await api.pair(send("POST", "/api/app/pair", { code: "AAAAAA" }))).status).toBe(404);
  });

  it("starts verification for a new number and protects one linked elsewhere", async () => {
    const { api, appStore } = setup();
    const pending = (await (await api.phone(send("POST", "/api/app/phone", { phone: "(706) 555-0100" }))).json()) as any;
    expect(pending).toMatchObject({ status: "pending", phone: "+17065550100", callNumber: "+14705969455" });
    expect(appStore.links).toEqual(["+17065550100"]);
    expect((await api.phone(send("POST", "/api/app/phone", { phone: "+1 555 000 1111" }))).status).toBe(409);
    expect(((await (await api.phone(send("POST", "/api/app/phone", { phone: "470-621-1642" }))).json()) as any).status).toBe("linked");
  });

  it("unlinks only the caller's own number", async () => {
    const { api, appStore } = setup();
    await api.phone(new Request("https://api.test/api/app/phone?phone=%2B15550001111", { method: "DELETE", headers: { authorization: "Bearer owner-token" } }));
    expect(appStore.phoneRows[OTHER]).toEqual(["+15550001111"]);
  });

  it("tells the Mac when its pairing code has expired", async () => {
    const routes = createMacPairingRoutes(() => env, () => ({}) as postgres.Sql, { makeAppStore: () => new FakeAppStore() });
    const response = await routes.status(
      new Request("https://api.test/api/mac/pair-status", {
        method: "POST",
        body: JSON.stringify({ pairingId: "pair_00000000-0000-0000-0000-000000000000", pollSecret: "x".repeat(43) }),
      }),
    );
    expect(response.status).toBe(410);
  });
});

describe("helpers", () => {
  it("normalizes phone numbers", () => {
    expect(toE164("(470) 621-1642")).toBe("+14706211642");
    expect(toE164("1 470 621 1642")).toBe("+14706211642");
    expect(toE164("+44 20 7946 0958")).toBe("+442079460958");
    expect(toE164("12345")).toBeNull();
  });

  it("seals a device token so only the server secret opens it", () => {
    const sealed = sealToken("spd_secret", "server-secret");
    expect(sealed).not.toContain("spd_secret");
    expect(openToken(sealed, "server-secret")).toBe("spd_secret");
    expect(() => openToken(sealed, "wrong")).toThrow();
  });

  it("recognises approvals and describes progress", () => {
    expect(isApprovalQuestion("Should I send this message to Alex?")).toBe(true);
    expect(isApprovalQuestion("Which Notes folder do you mean?")).toBe(false);
    expect(activityFor({ state: "accepted", last_step_response: null, step_count: 0 })).toBe("Starting");
    expect(activityFor({ state: "succeeded", last_step_response: null, step_count: 4 })).toBeNull();
  });
});

describe("single-function dispatch", () => {
  it("routes /api/app/* by path or rewrite parameter, and refuses unknown routes", async () => {
    const { createAppDispatcher } = await import("../../src/app/routes.js");
    const dispatch = createAppDispatcher(() => env, () => ({}) as postgres.Sql, {
      verifyUser: async () => ({ userId: OWNER, email: null }),
      makeAppStore: () => new FakeAppStore(),
      rooms: null,
      now: () => NOW,
    });
    expect((await dispatch(get("/api/app/home", "t"))).status).toBe(200);
    expect((await dispatch(get("/api/app?route=home", "t"))).status).toBe(200);
    expect((await dispatch(get("/api/app/task?id=tsk_1", "t"))).status).toBe(200);
    expect((await dispatch(get("/api/app/nope", "t"))).status).toBe(404);
    expect((await dispatch(send("GET", "/api/app/message", undefined, "t").clone())).status).toBe(404);
  });
});
