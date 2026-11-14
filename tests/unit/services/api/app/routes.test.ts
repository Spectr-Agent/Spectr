import { describe, expect, it, vi } from "vitest";
import { createAppDispatcher, toE164 } from "../../../../../services/api/src/app/routes.js";
import type { AppStore } from "../../../../../services/api/src/app/store.js";
import type { TaskRow } from "../../../../../services/api/src/app/views.js";
import type { LiveKitRooms } from "../../../../../services/api/src/livekit/app-token.js";
import type { TaskStore } from "../../../../../services/api/src/inbound.js";

const UUID = "123e4567-e89b-42d3-a456-426614174000";

function makeAppStore(over: Partial<AppStore> = {}): AppStore {
  return {
    macs: async () => [],
    phones: async () => [],
    pendingPhone: async () => null,
    task: async () => null,
    recentTasks: async () => [],
    startPairing: async () => ({ pairingId: "pair_1", code: "CODE12", expiresAt: "x" }),
    pollPairing: async () => ({ status: "pending", expiresAt: "x" }),
    approvePairing: async () => ({ status: "notFound" }),
    requestPhoneLink: async () => ({ status: "pending", expiresAt: "x" }),
    unlinkPhone: async () => undefined,
    ...over,
  };
}

const env = {
  POSTGRES_URL: "postgres://x",
  SUPABASE_URL: "https://sb.test/",
  SUPABASE_PUBLISHABLE_KEY: "pk",
  SPECTR_LINK_SECRET: "seal",
};

function makeDispatcher(over: {
  appStore?: Partial<AppStore>;
  taskStore?: Partial<TaskStore>;
  verifyUser?: (token: string) => Promise<{ userId: string; email: string | null } | null>;
  rooms?: LiveKitRooms | null;
  getEnv?: () => Record<string, string | undefined>;
} = {}) {
  return createAppDispatcher(over.getEnv ?? (() => env), () => ({} as never), {
    verifyUser: over.verifyUser ?? (async () => ({ userId: UUID, email: "a@b.c" })),
    makeAppStore: () => makeAppStore(over.appStore),
    makeTaskStore: () => ({
      routeInbound: vi.fn(async () => ({ taskId: "t1", kind: "task" as const, created: true })),
      ...(over.taskStore as object),
    }) as TaskStore,
    rooms: over.rooms,
    now: () => new Date("2025-06-01T00:00:00Z"),
  });
}

const authed = (path: string, init: RequestInit = {}) =>
  new Request(`http://api/api/app${path}`, {
    ...init,
    headers: { authorization: "Bearer tok", "content-type": "application/json", ...(init.headers ?? {}) },
  });

const taskRow = (over: Partial<TaskRow> = {}): TaskRow => ({
  id: "t1",
  device_id: "mac-1",
  state: "running",
  revision: 0,
  instruction: "do",
  question: null,
  summary: null,
  step_count: 0,
  last_step_response: null,
  reply_provider: "app",
  created_at: "2025-01-01T00:00:00Z",
  updated_at: "2025-01-01T00:00:00Z",
  has_screenshot: false,
  ...over,
});

describe("toE164 (app routes)", () => {
  it.each([
    [null, null],
    ["+44 20 7946 0958", "+442079460958"],
    ["+123", null],
    ["(470) 596-9455", "+14705969455"],
    ["1-470-596-9455", "+14705969455"],
    ["12345", null],
  ])("%j -> %j", (input, expected) => {
    expect(toE164(input)).toBe(expected);
  });
});

describe("dispatcher", () => {
  it("404s on unknown routes", async () => {
    expect((await makeDispatcher()(authed("/nope"))).status).toBe(404);
  });

  it("reports missing env before auth", async () => {
    const response = await makeDispatcher({ getEnv: () => ({}) })(authed("/home"));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ error: { code: "misconfigured" } });
  });

  it.each([
    ["GET", "/home"],
    ["GET", "/task"],
    ["POST", "/message"],
    ["POST", "/stop"],
    ["POST", "/live"],
    ["POST", "/pair"],
    ["POST", "/phone"],
  ] as const)("requires a bearer token on %s %s", async (method, route) => {
    const verifyUser = vi.fn();
    const dispatcher = makeDispatcher({ verifyUser });
    const response = await dispatcher(new Request(`http://api/api/app${route}`, { method }));
    expect(response.status).toBe(401);
    expect(verifyUser).not.toHaveBeenCalled();
  });

  it("maps verifier failures to 502 and rejections to 401", async () => {
    expect(
      (await makeDispatcher({ verifyUser: async () => { throw new Error("down"); } })(authed("/home"))).status,
    ).toBe(502);
    expect((await makeDispatcher({ verifyUser: async () => null })(authed("/home"))).status).toBe(401);
  });

  it("maps unexpected handler errors to 500", async () => {
    const dispatcher = makeDispatcher({ appStore: { macs: async () => { throw new Error("boom"); } } });
    expect((await dispatcher(authed("/home"))).status).toBe(500);
  });
});

describe("home and task", () => {
  it("answers home with account, macs, numbers and tasks", async () => {
    const dispatcher = makeDispatcher({
      appStore: {
        macs: async () => [{ id: "mac-1", name: "Mini", last_seen_at: null }],
        phones: async () => ["+14705969455"],
        pendingPhone: async () => ({ phone: "+14705969455", expiresAt: "x" }),
        recentTasks: async () => [taskRow({ state: "running" }), taskRow({ id: "t2", state: "succeeded" })],
      },
      rooms: { macIsSharing: async () => false, dispatchCallAgent: async () => undefined } as never,
    });
    const response = await dispatcher(authed("/home"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.userId).toBe(UUID);
    expect(body.macs).toHaveLength(1);
    expect(body.pendingPhone).toBeNull(); // already linked
    expect(body.activeTask.taskId).toBe("t1");
    expect(body.recentTasks).toHaveLength(2);
  });

  it("keeps a pending number that is not linked yet", async () => {
    const dispatcher = makeDispatcher({
      appStore: { pendingPhone: async () => ({ phone: "+1555", expiresAt: "e" }) },
    });
    const body = await (await makeDispatcher({
      appStore: { pendingPhone: async () => ({ phone: "+1555", expiresAt: "e" }) },
    })(authed("/home"))).json();
    void dispatcher;
    expect(body.pendingPhone).toEqual({ phone: "+1555", expiresAt: "e" });
  });

  it("answers one task or 404s", async () => {
    const dispatcher = makeDispatcher({ appStore: { task: async (_o, id) => (id === "t1" ? taskRow() : null) } });
    expect((await dispatcher(authed("/task?id=t1"))).status).toBe(200);
    expect((await dispatcher(authed("/task?id=t9"))).status).toBe(404);
    expect((await dispatcher(authed("/task"))).status).toBe(400);
  });
});

describe("message and stop", () => {
  it("rejects a bad message body", async () => {
    expect((await makeDispatcher()(authed("/message", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("requires a Mac and routes the text as an app message", async () => {
    const routeInbound = vi.fn(async () => ({ taskId: "t1", kind: "task" as const, created: true }));
    const dispatcher = makeDispatcher({
      appStore: { macs: async () => [{ id: "mac-1", name: "Mini", last_seen_at: null }], task: async () => taskRow() },
      taskStore: { routeInbound } as never,
    });
    const response = await dispatcher(authed("/message", {
      method: "POST",
      body: JSON.stringify({ text: "open Notes", clientMessageId: "clientid1" }),
    }));
    expect(response.status).toBe(200);
    expect(routeInbound).toHaveBeenCalledWith(expect.objectContaining({
      providerMessageId: `app:${UUID}:clientid1`,
      deviceId: "mac-1",
      replyProvider: "app",
    }));
    const noMac = await dispatcher(authed("/message", {
      method: "POST",
      body: JSON.stringify({ text: "hi", clientMessageId: "clientid2", deviceId: "mac-x" }),
    }));
    expect(noMac.status).toBe(409);
  });

  it("stops a running task and no-ops a finished one", async () => {
    const routeInbound = vi.fn(async () => ({ taskId: "t1", kind: "stop" as const, created: false }));
    const dispatcher = makeDispatcher({
      appStore: { task: async () => taskRow({ state: "running" }) },
      taskStore: { routeInbound } as never,
    });
    const response = await dispatcher(authed("/stop", {
      method: "POST",
      body: JSON.stringify({ taskId: "t1", clientMessageId: "clientid1" }),
    }));
    expect(response.status).toBe(200);
    expect(routeInbound).toHaveBeenCalledWith(expect.objectContaining({ text: "stop" }));

    const done = makeDispatcher({
      appStore: { task: async (_o, id) => (id === "t9" ? null : taskRow({ state: "succeeded" })) },
    });
    expect((await done(authed("/stop", {
      method: "POST",
      body: JSON.stringify({ taskId: "t1", clientMessageId: "clientid1" }),
    }))).status).toBe(200);
    const missing = await done(authed("/stop", {
      method: "POST",
      body: JSON.stringify({ taskId: "t9", clientMessageId: "clientid1" }),
    }));
    expect(missing.status).toBe(404);
    expect((await done(authed("/stop", { method: "POST", body: "{}" }))).status).toBe(400);
  });
});

describe("live", () => {
  const liveEnv = { ...env, LIVEKIT_URL: "wss://x", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" };

  it("fails when LiveKit is unconfigured", async () => {
    const dispatcher = makeDispatcher({ getEnv: () => env });
    expect((await dispatcher(authed("/live", {
      method: "POST",
      body: JSON.stringify({ mode: "watch" }),
    }))).status).toBe(500);
  });

  it("issues a watch grant for an owned Mac", async () => {
    const dispatcher = makeDispatcher({
      getEnv: () => liveEnv,
      appStore: { macs: async () => [{ id: "mac-1", name: "Mini", last_seen_at: null }] },
    });
    const response = await dispatcher(authed("/live", {
      method: "POST",
      body: JSON.stringify({ mode: "watch" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ deviceId: "mac-1" });
    expect((await dispatcher(authed("/live", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("dispatches the call agent for call mode and 409s without a Mac", async () => {
    const dispatchCallAgent = vi.fn(async () => undefined);
    const rooms = { macIsSharing: async () => false, dispatchCallAgent } as unknown as LiveKitRooms;
    const dispatcher = makeDispatcher({
      getEnv: () => liveEnv,
      appStore: { macs: async () => [{ id: "mac-1", name: "Mini", last_seen_at: null }] },
      rooms,
    });
    const response = await dispatcher(authed("/live", {
      method: "POST",
      body: JSON.stringify({ mode: "call" }),
    }));
    expect(response.status).toBe(200);
    expect(dispatchCallAgent).toHaveBeenCalled();

    const noRooms = makeDispatcher({
      getEnv: () => liveEnv,
      appStore: { macs: async () => [{ id: "mac-1", name: "Mini", last_seen_at: null }] },
      rooms: null,
    });
    expect((await noRooms(authed("/live", {
      method: "POST",
      body: JSON.stringify({ mode: "call" }),
    }))).status).toBe(500);
  });
});

describe("pair and phone", () => {
  it("approves a good code and 404s a bad one", async () => {
    const dispatcher = makeDispatcher({
      appStore: { approvePairing: async () => ({ status: "paired", deviceId: "mac-1", name: "Mini" }) },
    });
    const ok = await dispatcher(authed("/pair", { method: "POST", body: JSON.stringify({ code: "K7P4QX" }) }));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ deviceId: "mac-1", name: "Mini" });

    const bad = makeDispatcher({ appStore: { approvePairing: async () => ({ status: "notFound" }) } });
    expect((await bad(authed("/pair", { method: "POST", body: JSON.stringify({ code: "K7P4QX" }) }))).status).toBe(404);
    expect((await bad(authed("/pair", { method: "POST", body: "{}" }))).status).toBe(400);
  });

  it("starts a phone link, reports taken and removes numbers", async () => {
    const unlinkPhone = vi.fn(async () => undefined);
    const dispatcher = makeDispatcher({
      appStore: {
        requestPhoneLink: async () => ({ status: "pending" as const, expiresAt: "e" }),
        unlinkPhone,
      },
    });
    const linked = await dispatcher(authed("/phone", { method: "POST", body: JSON.stringify({ phone: "(470) 596-9455" }) }));
    expect(linked.status).toBe(200);
    expect(await linked.json()).toMatchObject({ phone: "+14705969455", status: "pending", expiresAt: "e" });

    expect((await dispatcher(authed("/phone", { method: "POST", body: JSON.stringify({ phone: "12" }) }))).status).toBe(400);

    const taken = makeDispatcher({ appStore: { requestPhoneLink: async () => ({ status: "taken" as const }) } });
    expect((await taken(authed("/phone", {
      method: "POST",
      body: JSON.stringify({ phone: "(470) 596-9455" }),
    }))).status).toBe(409);

    const removed = await dispatcher(authed("/phone?phone=4705969455", { method: "DELETE" }));
    expect(removed.status).toBe(200);
    expect(unlinkPhone).toHaveBeenCalledWith(UUID, "+14705969455");
    expect((await dispatcher(authed("/phone?phone=bad", { method: "DELETE" }))).status).toBe(400);
  });
});

describe("app dispatcher defaults", () => {
  it("signs screenshot links for task views with a stored shot", async () => {
    const dispatch = makeDispatcher({
      appStore: { recentTasks: async () => [taskRow({ has_screenshot: true })] },
    });
    const response = await dispatch(authed("/api/app/home"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.recentTasks[0].screenshotUrl).toContain("/api/tasks/screenshot?task=t1&sig=");
  });

  it("builds the Supabase verifier lazily and maps its failure to 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("dns"); }));
    try {
      const dispatch = createAppDispatcher(() => env, () => ({} as never), {
        makeAppStore: () => makeAppStore(),
        makeTaskStore: () => ({}) as TaskStore,
      });
      const response = await dispatch(authed("/api/app/home"));
      expect(response.status).toBe(502);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("uses the default sql client, which fails without a database", async () => {
    const dispatch = createAppDispatcher(() => env, undefined, {
      verifyUser: async () => ({ userId: UUID, email: null }),
    });
    // postgres() constructs lazily; the first query cannot reach host "x".
    const response = await dispatch(authed("/api/app/home"));
    expect(response.status).toBe(500);
  }, 20_000);
});
