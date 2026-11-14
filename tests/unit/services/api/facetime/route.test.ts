import { afterEach, describe, expect, it, vi } from "vitest";

const dispatches: Array<{ url: string; room: string; agent: string; metadata?: string }> = [];

vi.mock("livekit-server-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-server-sdk")>();
  class AgentDispatchClient {
    constructor(
      private readonly url: string,
      _key: string,
      _secret: string,
    ) {}
    async createDispatch(room: string, agentName: string, opts?: { metadata?: string }) {
      dispatches.push({ url: this.url, room, agent: agentName, metadata: opts?.metadata });
      return {} as never;
    }
  }
  return { ...actual, AgentDispatchClient };
});

import {
  createChertCallChecker,
  createFaceTimeRoute,
  randomCallId,
} from "../../../../../services/api/src/facetime/incoming.js";

const OWNER = { owner_id: "589aefe5-4901-4118-a761-90f5d86a737f", device_id: "mac-jared" };

const env = {
  POSTGRES_URL: "postgres://db.test/spectr",
  LIVEKIT_URL: "wss://project.livekit.test",
  LIVEKIT_API_KEY: "APItestkey",
  LIVEKIT_API_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
  CHERT_API_KEY: "ftk_test",
  CHERT_PROJECT_ID: "proj_1",
  SPECTR_FACETIME_OWNER_PHONE: "+14705969455",
};

const incoming = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: "call.incoming",
    data: { call_id: "call_abc", line_id: "line_1", media: { audio: true, video: true }, ...extra },
  });

const post = (body: string) => new Request("https://api.test/api/chert/facetime", { method: "POST", body });

/** Tagged-template fake returning one resolveSender row (or none). */
const sqlReturning = (rows: unknown[]) => (async () => rows) as never;

const chertReply = (body: unknown, status = 200) =>
  vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url).not.toContain("twirp"); // Chert fetches only hit the calls API
    return new Response(JSON.stringify(body), { status });
  });

afterEach(() => {
  dispatches.length = 0;
  vi.unstubAllGlobals();
});

describe("createFaceTimeRoute", () => {
  it("declines when required environment is missing, without touching Postgres", async () => {
    const route = createFaceTimeRoute(() => ({}), () => {
      throw new Error("makeSql must not run when env is missing");
    });
    const response = await route(post(incoming()));
    expect(await response.json()).toEqual({ action: "decline" });
  });

  it("accepts a call Chert confirms: resolves the owner, dispatches the agent, answers with a bridge token", async () => {
    vi.stubGlobal("fetch", chertReply({ call: { status: "ringing", line_id: "line_1" } }));
    const route = createFaceTimeRoute(() => env, () => sqlReturning([OWNER]));
    const response = await route(post(incoming()));
    const body = (await response.json()) as Record<string, string>;
    expect(body.action).toBe("accept");
    expect(body.livekit_url).toBe(env.LIVEKIT_URL);
    expect(body.remote_participant_identity).toBe("spectr-agent");
    expect(body.participant_token).toMatch(/^eyJ/u);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0]!.url).toBe("https://project.livekit.test");
    expect(dispatches[0]!.room).toBe("spectr-ft-call_abc");
    expect(dispatches[0]!.agent).toBe("spectr-call");
    expect(JSON.parse(dispatches[0]!.metadata!)).toEqual({
      chert_call: "call_abc",
      media: { audio: true, video: true },
      spectr_owner: { ownerId: OWNER.owner_id, deviceId: OWNER.device_id },
      spectr_poll_bridge: true,
    });
  });

  it("uses SPECTR_CALL_AGENT_NAME for the dispatch when set", async () => {
    vi.stubGlobal("fetch", chertReply({ status: "ringing", lineId: "line_1" }));
    const route = createFaceTimeRoute(() => ({ ...env, SPECTR_CALL_AGENT_NAME: "spectr-dev" }), () => sqlReturning([OWNER]));
    await route(post(incoming()));
    expect(dispatches[0]!.agent).toBe("spectr-dev");
  });

  it("declines when Chert says the call is already over, and does not dispatch", async () => {
    vi.stubGlobal("fetch", chertReply({ call: { status: "ended" } }));
    const route = createFaceTimeRoute(() => env, () => sqlReturning([OWNER]));
    expect(await (await route(post(incoming()))).json()).toEqual({ action: "decline" });
    expect(dispatches).toEqual([]);
  });

  it("fails closed when Postgres is unreachable with the default connector", async () => {
    vi.stubGlobal("fetch", chertReply({ call: { status: "ringing", line_id: "line_1" } }));
    const route = createFaceTimeRoute(() => ({ ...env, POSTGRES_URL: "postgres://127.0.0.1:1/spectr" }));
    expect(await (await route(post(incoming()))).json()).toEqual({ action: "decline" });
    expect(dispatches).toEqual([]);
  });

  it("declines when the owner phone has no paired Mac", async () => {
    vi.stubGlobal("fetch", chertReply({ call: { status: "ringing", line_id: "line_1" } }));
    const route = createFaceTimeRoute(() => env, () => sqlReturning([]));
    expect(await (await route(post(incoming()))).json()).toEqual({ action: "decline" });
    expect(dispatches).toEqual([]);
  });
});

describe("createChertCallChecker", () => {
  const config = { apiKey: "ftk_x", projectId: "p" };

  it("unwraps call bodies nested under data or returned flat", async () => {
    const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
    expect(await createChertCallChecker(config, reply({ data: { status: "ringing" } }))("c", undefined)).toBe(true);
    expect(await createChertCallChecker(config, reply({ status: "active" }))("c", undefined)).toBe(true);
  });

  it("only compares the line when Chert reports it as a string", async () => {
    const reply = (body: unknown) => async () => new Response(JSON.stringify(body), { status: 200 });
    expect(await createChertCallChecker(config, reply({ call: { status: "ringing", line_id: 42 } }))("c", "line_1")).toBe(true);
    expect(await createChertCallChecker(config, reply({ call: { status: "ringing" } }))("c", "line_1")).toBe(true);
  });

  it("sends the project id and bearer key to Chert", async () => {
    const seen = vi.fn(async () => new Response(JSON.stringify({ call: { status: "ringing" } }), { status: 200 }));
    await createChertCallChecker(config, seen)("call/x", undefined);
    const [url, init] = seen.mock.calls[0]!;
    expect(String(url)).toBe("https://facetime.trychert.com/api/v1/calls/call%2Fx");
    expect((init?.headers as Record<string, string>).authorization).toBe("Bearer ftk_x");
    expect((init?.headers as Record<string, string>)["x-chert-project-id"]).toBe("p");
  });
});

describe("randomCallId", () => {
  it("makes url-safe unique ids", () => {
    const ids = new Set(Array.from({ length: 20 }, () => randomCallId()));
    for (const id of ids) expect(id).toMatch(/^test_[0-9a-f]{12}$/u);
    expect(ids.size).toBe(20);
  });
});
