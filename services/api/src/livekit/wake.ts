// Nudges a Mac to check for work now instead of at its next idle poll (every 3 s).
//
// The Mac stays connected to its LiveKit room to stream its screen, so a server data
// message to the Mac's identity arrives in about a hundred milliseconds. The message
// carries no task and no instruction: it only makes the Mac poll `/api/mac/task`, which
// is authenticated as usual. A lost or forged wake therefore changes nothing; the poll
// still runs on schedule.
//
// Owner: Jared.

import { DataPacket_Kind, RoomServiceClient } from "livekit-server-sdk";
import { macIdentity, macRoomName } from "./mac-token.js";

export const WAKE_TOPIC = "spectr.wake";
export const WAKE_TIMEOUT_MS = 600;

/** Sends the wake; never throws and never waits longer than the timeout. */
export type WakeMac = (deviceId: string) => Promise<void>;

export interface WakeSender {
  sendData: RoomServiceClient["sendData"];
}

export function createMacWaker(
  config: { url?: string; apiKey?: string; apiSecret?: string },
  makeClient: (host: string, key: string, secret: string) => WakeSender = (host, key, secret) =>
    new RoomServiceClient(host, key, secret),
): WakeMac {
  if (!config.url || !config.apiKey || !config.apiSecret) return async () => {};
  const client = makeClient(
    config.url.replace(/^wss:/u, "https:").replace(/^ws:/u, "http:"),
    config.apiKey,
    config.apiSecret,
  );
  return async (deviceId) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        client.sendData(macRoomName(deviceId), new TextEncoder().encode("wake"), DataPacket_Kind.RELIABLE, {
          destinationIdentities: [macIdentity(deviceId)],
          topic: WAKE_TOPIC,
        }),
        new Promise((resolve) => {
          timer = setTimeout(resolve, WAKE_TIMEOUT_MS);
        }),
      ]);
    } catch (error) {
      // A Mac that isn't streaming has no room; it picks the task up at its next poll.
      console.info("Mac wake not delivered", error instanceof Error ? error.message.slice(0, 120) : "unknown");
    } finally {
      clearTimeout(timer);
    }
  };
}
