import { createHash, createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createMacStepRoute,
  createMacTaskRoute,
  createTaskScreenshotRoute,
} from "../../../../../services/api/src/agent/routes.js";
import { InMemoryTaskStore } from "../../../../../services/api/src/memory-store.js";
import { computer, reply, request, route, scriptedClaude } from "../../../../../services/api/test/helpers/agent-loop.js";

const deviceId = "dev_loop_mac";
const token = "device-token";
const tokenHash = createHash("sha256").update(token).digest("hex");

const fullEnv = {
  POSTGRES_URL: "postgres://x",
  ANTHROPIC_API_KEY: "key",
  SPECTR_LINK_SECRET: "seal",
  SENDBLUE_API_KEY_ID: "id",
  SENDBLUE_API_SECRET_KEY: "sec",
  SENDBLUE_FROM_NUMBER: "+1",
  CHERT_API_KEY: "ck",
  CHERT_PROJECT_ID: "p",
  CHERT_LINE_ID: "l",
};

function setupStore() {
  const store = new InMemoryTaskStore();
  store.deviceTokenHashes.set(tokenHash, deviceId);
  return store;
}

const authed = (init: RequestInit = {}, url = "http://api/x") =>
  new Request(url, { ...init, headers: { authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });

describe("createMacTaskRoute", () => {
  it("rejects misconfigured env and missing or bad tokens", async () => {
    const missing = createMacTaskRoute(() => ({}));
    expect((await missing(authed())).status).toBe(500);

    const route_ = createMacTaskRoute(() => ({ POSTGRES_URL: "x" }), () => ({}) as never, {
      makeStore: () => setupStore(),
    });
    expect((await route_(new Request("http://api/x"))).status).toBe(401);
    const bad = new Request("http://api/x", { headers: { authorization: "Bearer nope" } });
    expect((await route_(bad)).status).toBe(401);
  });

  it("returns the active task or null, invoking the default makeSql lazily", async () => {
    const store = setupStore();
    await route(store, "do things");
    // No makeSql override: the default postgres() constructor runs without connecting.
    const route_ = createMacTaskRoute(() => ({ POSTGRES_URL: "postgres://x" }), undefined, {
      makeStore: () => store,
    });
    const response = await route_(authed());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ task: { taskId: expect.any(String), state: "accepted" } });

    const empty = setupStore();
    const route2 = createMacTaskRoute(() => ({ POSTGRES_URL: "postgres://x" }), () => ({}) as never, {
      makeStore: () => empty,
    });
    expect(await (await route2(authed())).json()).toEqual({ task: null });
  });

  it("maps store failures to a 500", async () => {
    const route_ = createMacTaskRoute(() => ({ POSTGRES_URL: "x" }), () => ({}) as never, {
      makeStore: () => { throw new Error("db"); },
    });
    expect((await route_(authed())).status).toBe(500);
  });
});

describe("createMacStepRoute", () => {
  const stepRequest = (taskId: string) => JSON.stringify(request(taskId));

  it("rejects misconfigured env, missing token and bad bodies", async () => {
    const route_ = createMacStepRoute(() => ({}));
    expect((await route_(authed({ method: "POST" }))).status).toBe(500);

    const store = setupStore();
    const withStore = createMacStepRoute(() => fullEnv, () => ({}) as never, { makeStore: () => store });
    expect((await withStore(new Request("http://api/x", { method: "POST" }))).status).toBe(401);
    expect((await withStore(authed({ method: "POST", body: "not json" }))).status).toBe(400);
    expect((await withStore(authed({ method: "POST", body: "{}" }))).status).toBe(400);

    const badToken = new Request("http://api/x", {
      method: "POST",
      headers: { authorization: "Bearer nope" },
      body: stepRequest("tsk_1"),
    });
    expect((await withStore(badToken)).status).toBe(401);
  });

  it("runs a step and notifies through the provider replier", async () => {
    const store = setupStore();
    const { taskId } = await route(store, "open Notes");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const claude = scriptedClaude(reply(custom0("a1")));
    const route_ = createMacStepRoute(() => fullEnv, () => ({}) as never, {
      makeStore: () => store,
      callClaude: claude.call,
      fetch: fetchImpl as unknown as typeof fetch,
    });
    const response = await route_(authed({ method: "POST", body: stepRequest(taskId) }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: "waiting" });
    // The question notification went out over the sendblue replier.
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining("api.sendblue.com"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("maps step failures to a 500", async () => {
    const route_ = createMacStepRoute(() => fullEnv, () => ({}) as never, {
      makeStore: () => { throw new Error("db"); },
    });
    expect((await route_(authed({ method: "POST", body: "{}" }))).status).toBe(400);
    const store = setupStore();
    const { taskId } = await route(store, "open Notes");
    const crashing = createMacStepRoute(() => fullEnv, () => ({}) as never, {
      makeStore: () => ({
        authenticateDevice: async () => { throw new Error("db"); },
      }) as never,
    });
    void store;
    expect((await crashing(authed({ method: "POST", body: stepRequest(taskId) }))).status).toBe(500);
  });
});

function custom0(id: string) {
  return { type: "tool_use", id, name: "ask_user", input: { question: "ok?" } };
}

describe("createTaskScreenshotRoute", () => {
  const url = (taskId: string, sig?: string) =>
    `http://api/api/tasks/screenshot?task=${taskId}&sig=${sig ?? "x"}`;
  const sig = (taskId: string) => createHmac("sha256", "seal").update(taskId).digest("hex");

  it("rejects misconfigured env and bad signatures", async () => {
    const misconfigured = await createTaskScreenshotRoute(() => ({}))(authed({}, url("t")));
    expect(misconfigured.status).toBe(500);
    const store = setupStore();
    const route_ = createTaskScreenshotRoute(() => ({ POSTGRES_URL: "x", SPECTR_LINK_SECRET: "seal" }), () => ({}) as never, {
      makeStore: () => store,
    });
    expect((await route_(authed({}, "http://api/x"))).status).toBe(404);
    expect((await route_(authed({}, url("t", "zzz")))).status).toBe(404);
    expect((await route_(authed({}, url("t", sig("other"))))).status).toBe(404);
    expect((await route_(authed({}, url("t", sig("t"))))).status).toBe(404); // no task
  });

  it("serves the final screenshot for a signed link", async () => {
    const store = setupStore();
    const { taskId } = await route(store, "x");
    const task = (await store.getTask(taskId))!;
    task.state = "succeeded";
    task.finalScreenshot = new Uint8Array([1, 2, 3]);
    task.finalScreenshotType = "image/png";
    const route_ = createTaskScreenshotRoute(() => ({ POSTGRES_URL: "x", SPECTR_LINK_SECRET: "seal" }), () => ({}) as never, {
      makeStore: () => store,
    });
    const response = await route_(authed({}, url(taskId, sig(taskId))));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");

    task.finalScreenshot = null;
    expect((await route_(authed({}, url(taskId, sig(taskId))))).status).toBe(404);
  });

  it("maps store failures to a 500", async () => {
    const route_ = createTaskScreenshotRoute(() => ({ POSTGRES_URL: "x", SPECTR_LINK_SECRET: "seal" }), () => ({}) as never, {
      makeStore: () => { throw new Error("db"); },
    });
    expect((await route_(authed({}, url("t", sig("t"))))).status).toBe(500);
  });
});

describe("step notifier edge cases", () => {
  const stepRequest = (taskId: string) => JSON.stringify(request(taskId));
  const ask = () => reply({ type: "tool_use", id: "q1", name: "ask_user", input: { question: "ok?" } });
  const makeRoute_ = (store: InMemoryTaskStore, extra: Record<string, unknown> = {}) =>
    createMacStepRoute(() => fullEnv, () => ({}) as never, { makeStore: () => store, ...extra });

  it("returns early when the task has no reply handle", async () => {
    const store = setupStore();
    const { taskId } = await route(store, "x");
    (await store.getTask(taskId))!.replyHandle = null;
    const route_ = makeRoute_(store, { callClaude: async () => ask() });
    expect((await route_(authed({ method: "POST", body: stepRequest(taskId) }))).status).toBe(200);
  });

  it("logs and skips unknown providers for question and result sends", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const store = setupStore();
      const { taskId } = await route(store, "x");
      (await store.getTask(taskId))!.replyProvider = "app";
      const route_ = makeRoute_(store, {
        callClaude: scriptedClaude(
          ask(),
          reply({ type: "tool_use", id: "f", name: "finish", input: { success: true, summary: "done" } }),
        ).call,
      });
      expect((await route_(authed({ method: "POST", body: stepRequest(taskId) }))).status).toBe(200);
      expect(info.mock.calls.map((c) => String(c[0])).join("\n")).toContain("app");
    } finally {
      info.mockRestore();
    }
  });

  it("sends a chert question through the global fetch", async () => {
    const store = setupStore();
    const { taskId } = await route(store, "x");
    (await store.getTask(taskId))!.replyProvider = "chert";
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const route_ = makeRoute_(store, { callClaude: async () => ask() });
      expect((await route_(authed({ method: "POST", body: stepRequest(taskId) }))).status).toBe(200);
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("shared-messages");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("skips the result text for non-sendblue tasks", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    try {
      const store = setupStore();
      const { taskId } = await route(store, "x");
      (await store.getTask(taskId))!.replyProvider = "chert";
      const route_ = makeRoute_(store, {
        callClaude: async () => reply({ type: "tool_use", id: "f", name: "finish", input: { success: true, summary: "done" } }),
      });
      expect((await route_(authed({ method: "POST", body: stepRequest(taskId) }))).status).toBe(200);
      expect(info.mock.calls.map((c) => String(c[0])).join("\n")).toContain("chert");
    } finally {
      info.mockRestore();
    }
  });

  it("attaches a signed media url to a finished sendblue result", async () => {
    const store = setupStore();
    const { taskId } = await route(store, "x");
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 200 }));
    const route_ = makeRoute_(store, {
      callClaude: async () => reply({ type: "tool_use", id: "f", name: "finish", input: { success: true, summary: "done", attach_screenshot: true } }),
      fetch: fetchImpl,
    });
    expect((await route_(authed({ method: "POST", body: stepRequest(taskId) }))).status).toBe(200);
    const body = JSON.parse(String((fetchImpl.mock.calls[0]?.[1] as RequestInit).body));
    expect(body.media_url).toContain("/api/tasks/screenshot?task=");
  });

  it("falls back to the real Anthropic caller when none is injected", async () => {
    const store = setupStore();
    const { taskId } = await route(store, "x");
    const anthropicJson = {
      content: [{ type: "tool_use", id: "f", name: "finish", input: { success: true, summary: "done" } }],
      stop_reason: "tool_use",
    };
    const fetchMock = vi.fn(async (url: RequestInfo | URL) =>
      String(url).includes("anthropic.com")
        ? new Response(JSON.stringify(anthropicJson), { status: 200 })
        : new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    try {
      const route_ = makeRoute_(store);
      const response = await route_(authed({ method: "POST", body: stepRequest(taskId) }));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ kind: "finished", state: "succeeded" });
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("anthropic.com");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
