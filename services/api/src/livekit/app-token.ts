// LiveKit access for the signed-in iPhone app, always in the owner's own Mac room
// (`spectr-mac-<deviceId>`).
//
// - watch: subscribe only. The app sees the Mac's screen and publishes nothing.
// - call:  subscribe plus microphone. The call agent is dispatched into the same room,
//          so the caller hears Spectr and watches the Mac in one connection. The call
//          identity is `user:<ownerId>`, which is how the agent recognises the owner.
//
// Owner: Jared.

import { randomBytes } from "node:crypto";
import { AccessToken, AgentDispatchClient, RoomServiceClient, TrackSource } from "livekit-server-sdk";
import { macIdentity, macRoomName } from "./mac-token.js";

export type AppLiveMode = "watch" | "call";

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

export interface AppLiveGrant {
  url: string;
  token: string;
  room: string;
  identity: string;
  mode: AppLiveMode;
  expiresAt: string;
}

export const APP_GRANT_TTL_SECONDS = 60 * 60;
export const callIdentity = (ownerId: string) => `user:${ownerId}`;

export async function appLiveGrant(
  config: LiveKitConfig,
  input: { ownerId: string; deviceId: string; mode: AppLiveMode },
  now: Date = new Date(),
): Promise<AppLiveGrant> {
  const room = macRoomName(input.deviceId);
  const identity =
    input.mode === "call" ? callIdentity(input.ownerId) : `watch:${input.ownerId}:${randomBytes(3).toString("hex")}`;
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity,
    name: "iPhone",
    ttl: APP_GRANT_TTL_SECONDS,
  });
  token.addGrant({
    room,
    roomJoin: true,
    canSubscribe: true,
    canPublish: input.mode === "call",
    canPublishSources: input.mode === "call" ? [TrackSource.MICROPHONE] : [],
    canPublishData: false,
  });
  return {
    url: config.url,
    token: await token.toJwt(),
    room,
    identity,
    mode: input.mode,
    expiresAt: new Date(now.getTime() + APP_GRANT_TTL_SECONDS * 1000).toISOString(),
  };
}

const httpHost = (url: string) => url.replace(/^wss:/u, "https:").replace(/^ws:/u, "http:");

export interface LiveKitRooms {
  /** Starts a fresh call agent in the room, replacing any earlier one. */
  dispatchCallAgent(room: string, agentName: string, callerIdentity: string): Promise<void>;
  /** Whether the Mac is publishing its screen; null when LiveKit can't say. */
  macIsSharing(deviceId: string): Promise<boolean | null>;
}

export function createLiveKitRooms(config: LiveKitConfig): LiveKitRooms {
  const dispatch = new AgentDispatchClient(httpHost(config.url), config.apiKey, config.apiSecret);
  const rooms = new RoomServiceClient(httpHost(config.url), config.apiKey, config.apiSecret);
  return {
    async dispatchCallAgent(room, agentName, callerIdentity) {
      const existing = await dispatch.listDispatch(room).catch(() => []);
      for (const item of existing) {
        if (item.agentName === agentName) await dispatch.deleteDispatch(item.id, room).catch(() => undefined);
      }
      await dispatch.createDispatch(room, agentName, {
        metadata: JSON.stringify({ spectr_app_identity: callerIdentity }),
      });
    },
    async macIsSharing(deviceId) {
      try {
        const participants = await Promise.race([
          rooms.listParticipants(macRoomName(deviceId)),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), 2_500)),
        ]);
        const mac = participants.find((participant) => participant.identity === macIdentity(deviceId));
        return Boolean(mac?.tracks.some((track) => track.source === TrackSource.SCREEN_SHARE));
      } catch (error) {
        // A room that doesn't exist yet means nothing is being shared.
        return /not.?found|does not exist/iu.test(String(error)) ? false : null;
      }
    },
  };
}
