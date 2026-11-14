import { createHash } from "node:crypto";
import { TokenVerifier } from "livekit-server-sdk";
import type postgres from "postgres";
import { describe, expect, it } from "vitest";
import type { TaskStore } from "../../src/inbound.js";
import { createMacLiveKitRoute, macLiveKitGrant } from "../../src/livekit/mac-token.js";

const env = {
  POSTGRES_URL: "postgres://unused",
  LIVEKIT_URL: "wss://project.example.test",
  LIVEKIT_API_KEY: "APItestkey",
  LIVEKIT_API_SECRET: "test-secret-that-is-long-enough-for-hs256-signing",
};

const validToken = "spd_valid";
const validHash = createHash("sha256").update(validToken).digest("hex");

function route(overrideEnv: Record<string, string | undefined> = env) {
  const store = {
    async authenticateDevice(hash: string) {
      return hash === validHash ? "mac-demo" : null;
    },
  } as unknown as TaskStore;
  return createMacLiveKitRoute(
    () => overrideEnv,
    () => ({}) as postgres.Sql,
    { makeStore: () => store, now: () => new Date("2026-11-14T00:00:00Z") },
  );
}

const request = (token?: string) =>
  new Request("https://api.example.test/api/mac/livekit", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("GET /api/mac/livekit", () => {
  it("issues a publish-only screen-share grant for the device's own room", async () => {
    const response = await route()(request(validToken));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { url: string; token: string; room: string; identity: string; expiresAt: string };
    expect(body.room).toBe("spectr-mac-mac-demo");
    expect(body.identity).toBe("mac-mac-demo");
    expect(body.url).toBe(env.LIVEKIT_URL);
    expect(body.expiresAt).toBe("2026-11-14T01:00:00.000Z");

    const claims = await new TokenVerifier(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET).verify(body.token);
    expect(claims.sub).toBe("mac-mac-demo");
    expect(claims.video?.room).toBe("spectr-mac-mac-demo");
    expect(claims.video?.roomJoin).toBe(true);
    expect(claims.video?.canPublish).toBe(true);
    expect(claims.video?.canSubscribe).toBe(false);
    expect(claims.video?.canPublishData).toBe(false);
    expect(claims.video?.canPublishSources).toEqual(["screen_share"]);
    expect(claims.video?.roomAdmin).toBeFalsy();
  });

  it("rejects a missing or unknown device token without issuing anything", async () => {
    for (const token of [undefined, "spd_wrong"]) {
      const response = await route()(request(token));
      expect(response.status).toBe(401);
      const text = await response.text();
      expect(text).not.toContain("eyJ");
    }
  });

  it("refuses to run without LiveKit configuration and names what's missing", async () => {
    const response = await route({ ...env, LIVEKIT_API_SECRET: undefined })(request(validToken));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("LIVEKIT_API_SECRET");
  });

  it("never puts the API secret in the grant", async () => {
    const grant = await macLiveKitGrant(
      { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET },
      "dev_1",
    );
    expect(JSON.stringify(grant)).not.toContain(env.LIVEKIT_API_SECRET);
  });
});
