// Shows the Mac's shared screen on a video call.
//
// The Mac publishes its shared window or display as a screen-share track in its own
// room (`spectr-mac-<deviceId>`). On a FaceTime call, Chert shows video only from the
// participant that speaks, so the agent subscribes to the Mac's screen (as a hidden
// participant) and republishes the frames as its own camera track in the call room.

import {
  LocalVideoTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackSource,
  VideoSource,
  VideoStream,
  type VideoFrame,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "@livekit/rtc-node";
import { AccessToken } from "livekit-server-sdk";

export const macRoomName = (deviceId: string) => `spectr-mac-${deviceId}`;
export const RELAY_MAX_BITRATE = 8_000_000n;
export const RELAY_MAX_FPS = 30;
/** With no new frame for this long, the last one is sent again. */
export const RELAY_HOLD_MS = 100;

export interface LiveKitServerConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/** A short-lived, subscribe-only, hidden token for watching one Mac's room. */
export async function relayToken(config: LiveKitServerConfig, deviceId: string, callId: string): Promise<string> {
  const token = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `spectr-relay-${callId}`,
    ttl: "2h",
  });
  token.addGrant({
    room: macRoomName(deviceId),
    roomJoin: true,
    canSubscribe: true,
    canPublish: false,
    canPublishData: false,
    hidden: true,
  });
  return token.toJwt();
}

export interface ScreenRelay {
  stop(): Promise<void>;
}

/**
 * Starts relaying. Resolves once connected to the Mac's room; frames flow when the
 * Mac is sharing. If the Mac isn't sharing, the call shows nothing from Spectr until
 * it starts.
 */
export async function startScreenRelay(options: {
  config: LiveKitServerConfig;
  deviceId: string;
  callId: string;
  callRoom: Room;
  onSharingChanged?: (sharing: boolean) => void;
}): Promise<ScreenRelay> {
  const macRoom = new Room();
  let source: VideoSource | undefined;
  let track: LocalVideoTrack | undefined;
  let pumping: Promise<void> | undefined;
  let stopped = false;
  // A video call shows gray whenever it has no recent picture to decode: at the start,
  // after packet loss, and while the Mac's stream pauses or reconnects. Sending the last
  // frame again keeps a picture on the call and answers keyframe requests at once.
  let held: VideoFrame | undefined;
  let heldAt = 0;
  const hold = setInterval(() => {
    if (stopped || !held || !source || Date.now() - heldAt < RELAY_HOLD_MS) return;
    if (source.width !== held.width || source.height !== held.height) return;
    heldAt = Date.now();
    try {
      source.captureFrame(held);
    } catch {
      // The source closed between the check and the send.
    }
  }, RELAY_HOLD_MS);

  const publish = async (width: number, height: number) => {
    if (source && source.width === width && source.height === height) return;
    if (track) await options.callRoom.localParticipant?.unpublishTrack(track.sid ?? "").catch(() => {});
    await source?.close().catch(() => {});
    source = new VideoSource(width, height);
    track = LocalVideoTrack.createVideoTrack("spectr-mac-screen", source);
    await options.callRoom.localParticipant?.publishTrack(track, {
      source: TrackSource.SOURCE_CAMERA,
      simulcast: false,
      // Text on a screen needs bits, not frames: re-encode the Mac's screen sharply.
      videoEncoding: { maxBitrate: RELAY_MAX_BITRATE, maxFramerate: RELAY_MAX_FPS },
    } as never);
  };

  const pump = async (remote: RemoteTrack) => {
    const stream = new VideoStream(remote);
    options.onSharingChanged?.(true);
    try {
      for await (const event of stream) {
        if (stopped) break;
        await publish(event.frame.width, event.frame.height);
        source?.captureFrame(event.frame);
        held = event.frame;
        heldAt = Date.now();
      }
    } finally {
      options.onSharingChanged?.(false);
    }
  };

  macRoom.on(
    RoomEvent.TrackSubscribed,
    (remote: RemoteTrack, publication: RemoteTrackPublication) => {
      if (remote.kind !== TrackKind.KIND_VIDEO || publication.source !== TrackSource.SOURCE_SCREENSHARE) return;
      pumping = pump(remote).catch(() => {});
    },
  );

  await macRoom.connect(options.config.url, await relayToken(options.config, options.deviceId, options.callId), {
    autoSubscribe: true,
    dynacast: false,
  });

  return {
    async stop() {
      stopped = true;
      clearInterval(hold);
      held = undefined;
      await macRoom.disconnect().catch(() => {});
      await pumping;
      if (track) await options.callRoom.localParticipant?.unpublishTrack(track.sid ?? "").catch(() => {});
      await source?.close().catch(() => {});
    },
  };
}
