// GET /api/mac/livekit — a short-lived LiveKit grant for the paired Mac.
//
// The Mac authenticates with its device token (the same one /api/mac/task uses) and
// receives a token that can only publish a screen share into its own room,
// `spectr-mac-<deviceId>`. It cannot subscribe, send data or join any other room.
// The LiveKit API secret never leaves the server.
//
// Owner: Jared (taken over from Colby's room-token work).

import { createHash } from "node:crypto";
import postgres from "postgres";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import type { TaskStore } from "../inbound.js";
import { PostgresTaskStore } from "../pg-store.js";
import type { RouteOverrides } from "../route-deps.js";

type RouteEnvironment = Record<string, string | undefined>;
type MakeSql = (url: string) => postgres.Sql;

export const MAC_GRANT_TTL_SECONDS = 60 * 60;

export const macRoomName = (deviceId: string) => `spectr-mac-${deviceId}`;
export const macIdentity = (deviceId: string) => `mac-${deviceId}`;

export interface MacLiveKitGrant {
  url: string;
  token: string;
  room: string;
  identity: string;
  expiresAt: string;
}

/** Builds the grant. Exported for tests and for the call agent's own tooling. */
export async function macLiveKitGrant(
  config: { url: string; apiKey: string; apiSecret: string },
  deviceId: string,
  now: Date = new Date(),
): Promise<MacLiveKitGrant> {
  const room = macRoomName(deviceId);
  const identity = macIdentity(deviceId);
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: "Mac",
    ttl: MAC_GRANT_TTL_SECONDS,
  });
  token.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishSources: [TrackSource.SCREEN_SHARE],
    canSubscribe: false,
    canPublishData: false,
  });
  return {
    url: config.url,
    token: await token.toJwt(),
    room,
    identity,
    expiresAt: new Date(now.getTime() + MAC_GRANT_TTL_SECONDS * 1000).toISOString(),
  };
}

function error(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message, currentRevision: null } }, { status });
}

export function createMacLiveKitRoute(
  getEnv: () => RouteEnvironment,
  makeSql: MakeSql = (url) => postgres(url, { prepare: false, max: 1 }),
  overrides?: RouteOverrides & { now?: () => Date },
): (request: Request) => Promise<Response> {
  let sql: postgres.Sql | undefined;
  return async (request) => {
    const env = getEnv();
    const missing = ["POSTGRES_URL", "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"].filter(
      (name) => !env[name],
    );
    if (missing.length > 0) {
      console.error(missing.join(", "));
      return error(500, "misconfigured", `Missing environment variables: ${missing.join(", ")}`);
    }
    const match = request.headers.get("authorization")?.match(/^Bearer ([^\s]+)$/u);
    if (!match?.[1]) return error(401, "forbidden", "A valid Mac device token is required.");
    try {
      const connection = (sql ??= makeSql(env.POSTGRES_URL!));
      const store: TaskStore = overrides?.makeStore?.(connection) ?? new PostgresTaskStore(connection);
      const deviceId = await store.authenticateDevice(createHash("sha256").update(match[1]).digest("hex"));
      if (!deviceId) return error(401, "forbidden", "A valid Mac device token is required.");
      const grant = await macLiveKitGrant(
        { url: env.LIVEKIT_URL!, apiKey: env.LIVEKIT_API_KEY!, apiSecret: env.LIVEKIT_API_SECRET! },
        deviceId,
        overrides?.now?.() ?? new Date(),
      );
      return Response.json(grant, { headers: { "cache-control": "no-store" } });
    } catch {
      return error(500, "upstreamError", "Could not issue a LiveKit grant.");
    }
  };
}
