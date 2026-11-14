import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("livekit-server-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("livekit-server-sdk")>();
  class AgentDispatchClient {
    async listDispatch(_room: string) {
      return AgentDispatchClient.dispatches;
    }
    static dispatches: Array<{ id: string; agentName: string }> = [];
    async deleteDispatch(id: string) {
      AgentDispatchClient.dispatches = AgentDispatchClient.dispatches.filter((d) => d.id !== id);
    }
    async createDispatch(room: string, agentName: string, opts?: { metadata?: string }) {
      AgentDispatchClient.created.push({ room, agentName, metadata: opts?.metadata });
    }
    static created: Array<{ room: string; agentName: string; metadata?: string }> = [];
  }
  class RoomServiceClient {
    async listParticipants(room: string) {
      if (RoomServiceClient.error) throw RoomServiceClient.error;
      return RoomServiceClient.rooms.get(room) ?? [];
    }
    static rooms = new Map<string, Array<{ identity: string; tracks: Array<{ source: unknown }> }>>();
    static error: Error | null = null;
  }
  return { ...actual, AgentDispatchClient, RoomServiceClient };
});

import { AgentDispatchClient, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { createLiveKitRooms } from "../../../../services/api/src/livekit/app-token.js";
import { createMacLiveKitRoute, macIdentity, macRoomName } from "../../../../services/api/src/livekit/mac-token.js";
import { InMemoryTaskStore } from "../../../../services/api/src/memory-store.js";

const config = { url: "wss://lk.test", apiKey: "k", apiSecret: "s" };

describe("createLiveKitRooms", () => {
  it("replaces an existing agent dispatch with a fresh one", async () => {
    const rooms = createLiveKitRooms(config);
    (AgentDispatchClient as unknown as { dispatches: unknown[] }).dispatches = [
      { id: "d1", agentName: "spectr-call" },
      { id: "d2", agentName: "other" },
    ];
    (AgentDispatchClient as unknown as { created: unknown[] }).created = [];
    await rooms.dispatchCallAgent("spectr-mac-m1", "spectr-call", "user:u1");
    expect((AgentDispatchClient as unknown as { dispatches: unknown[] }).dispatches).toEqual([{ id: "d2", agentName: "other" }]);
    expect((AgentDispatchClient as unknown as { created: Array<{ metadata?: string }> }).created[0]).toMatchObject({
      room: "spectr-mac-m1",
      agentName: "spectr-call",
    });
    expect(JSON.parse((AgentDispatchClient as unknown as { created: Array<{ metadata?: string }> }).created[0]!.metadata!))
      .toEqual({ spectr_app_identity: "user:u1" });
  });

  it.each([
    [[{ identity: "mac-m1", tracks: [{ source: "SCREEN_SHARE" }] }], true],
    [[{ identity: "mac-m1", tracks: [{ source: "CAMERA" }] }], false],
    [[], false],
  ])("macIsSharing with %j -> %s", async (participants, expected) => {
    const rooms = createLiveKitRooms(config);
    const map = new Map([[macRoomName("m1"), participants.map((p) => ({ ...p, tracks: p.tracks.map((t) => ({ source: t.source === "SCREEN_SHARE" ? TrackSource.SCREEN_SHARE : TrackSource.CAMERA })) }))]]);
    (RoomServiceClient as unknown as { rooms: Map<string, unknown>; error: Error | null }).rooms = map as never;
    (RoomServiceClient as unknown as { error: Error | null }).error = null;
    expect(await rooms.macIsSharing("m1")).toBe(expected);
  });

  it("macIsSharing maps a missing room to false and other failures to null", async () => {
    const rooms = createLiveKitRooms(config);
    const rs = RoomServiceClient as unknown as { error: Error | null; rooms: Map<string, unknown> };
    rs.rooms = new Map();
    rs.error = new Error("room not found");
    expect(await rooms.macIsSharing("m1")).toBe(false);
    rs.error = new Error("connection reset");
    expect(await rooms.macIsSharing("m1")).toBeNull();
    rs.error = null;
  });
});

describe("createMacLiveKitRoute", () => {
  const env = { POSTGRES_URL: "x", LIVEKIT_URL: "wss://lk", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" };
  const token = "mac-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const authed = () => new Request("http://api/api/mac/livekit", { headers: { authorization: `Bearer ${token}` } });

  it("issues a publish-only grant for an authenticated Mac", async () => {
    const store = new InMemoryTaskStore();
    store.deviceTokenHashes.set(tokenHash, "mac-1");
    const route_ = createMacLiveKitRoute(() => env, () => ({}) as never, { makeStore: () => store });
    const response = await route_(authed());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      url: "wss://lk",
      room: "spectr-mac-mac-1",
      identity: macIdentity("mac-1"),
    });
  });

  it("rejects missing env, missing and bad tokens via the default sql", async () => {
    expect((await createMacLiveKitRoute(() => ({}))(authed())).status).toBe(500);
    expect((await createMacLiveKitRoute(() => env)(new Request("http://api/x"))).status).toBe(401);
    const store = new InMemoryTaskStore();
    // Unknown token hash: authenticateDevice resolves null, so the route 401s.
    const route_ = createMacLiveKitRoute(() => env, () => ({}) as never, { makeStore: () => store });
    expect((await route_(authed())).status).toBe(401);
  });

  it("maps internal failures to a 500", async () => {
    const route_ = createMacLiveKitRoute(() => env, () => { throw new Error("sql gone"); });
    expect((await route_(authed())).status).toBe(500);
  });
});

describe("createMacLiveKitRoute default sql", () => {
  it("builds the postgres client lazily and 500s without a database", async () => {
    const env = { POSTGRES_URL: "postgres://x", LIVEKIT_URL: "wss://lk", LIVEKIT_API_KEY: "k", LIVEKIT_API_SECRET: "s" };
    const token = "mac-token";
    const authed = () => new Request("http://api/api/mac/livekit", { headers: { authorization: `Bearer ${token}` } });
    expect((await createMacLiveKitRoute(() => env)(authed())).status).toBe(500);
  }, 20_000);
});
